import express from "express";
import crypto from "crypto";
import { effectiveRole } from "@acmp/shared";
import { recordAudit } from "../services/audit.js";
import { findCompanyById } from "../services/companyStore.js";
import {
  createUser,
  findUserByEmail,
  findUserById,
  findUserByResetToken,
  findUserByVerificationToken,
  findUserDocById,
  hashPassword,
  saveUser,
  toActor,
  validatePassword
} from "../services/userStore.js";
import { sendEmail } from "../utils/email.js";
import { getTokenTtlSeconds, signToken, signValue, verifyToken } from "../utils/jwt.js";

const router = express.Router();
const requireEmailVerification = process.env.REQUIRE_EMAIL_VERIFICATION === "true";
const clientUrl = process.env.CLIENT_URL || "http://localhost:4410";

function isStrongPassword(pwd) {
  if (typeof pwd !== "string") return false;
  const minLength = 8;
  const hasNumber = /[0-9]/.test(pwd);
  const hasUpper = /[A-Z]/.test(pwd);
  return pwd.length >= minLength && hasNumber && hasUpper;
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";
  const cookies = Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)])
  );
  return cookies[name];
}

function authCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  };
}

function validationError(res, message) {
  return res.status(400).json({ error: message });
}

function serializeUser(user) {
  return {
    id: String(user._id),
    email: user.email,
    name: user.name,
    role: user.role,
    accessRole: effectiveRole(user),
    companyId: user.companyId ? String(user.companyId) : null,
    phone: user.phone,
    profilePic: user.profilePic,
    socialLinks: user.socialLinks || {},
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

async function getAuthenticatedUser(req) {
  const token = getCookie(req, "auth_token") || req.headers["authorization"]?.replace(/^Bearer\s+/, "");
  if (!token) {
    return null;
  }

  const payload = verifyToken(token);
  if (!payload?.id) {
    return null;
  }

  const user = await findUserDocById(payload.id);
  return user && user.isActive !== false ? user : null;
}

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

const otpDigest = (userId, code) => signValue(`${userId}:${code}`, "otp");

function clearOtp(user) {
  user.otpHash = undefined;
  user.otpExpires = undefined;
  user.otpAttempts = 0;
}

function startSession(res, user) {
  const token = signToken({ id: String(user._id), email: user.email });
  res.cookie("auth_token", token, {
    ...authCookieOptions(),
    maxAge: getTokenTtlSeconds() * 1000
  });
}

// serializeUser plus the company's name, for the web app's header and permission checks.
async function serializeWithCompany(user) {
  const company = user.companyId ? await findCompanyById(user.companyId) : null;
  return { ...serializeUser(user), companyName: company?.name ?? null };
}

function maskEmail(address) {
  return String(address).replace(/^(.).*@/, "$1***@");
}

router.post("/signup", async (req, res) => {
    const { email, password, name, role, phone } = req.body || {};
    if (!isEmail(email)) return validationError(res, "Valid email required");
    if (!String(name || "").trim()) return validationError(res, "Name required");
    if (!isStrongPassword(password)) {
      return validationError(res, "Password must be at least 8 characters and include an uppercase letter and number");
    }

    try {
      const existing = await findUserByEmail(email);
      if (existing) return res.status(409).json({ error: "User already exists" });

      const verificationToken = crypto.randomBytes(32).toString("hex");
      const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

      const created = await createUser({ email, password, name, role, phone, verificationToken, verificationExpires, requireEmailVerification });
      await recordAudit({
        actor: toActor(created),
        action: "auth.signup",
        entityType: "user",
        entityId: String(created._id),
        summary: `${created.email} signed up as ${effectiveRole(created)}`,
        meta: { accessRole: effectiveRole(created) }
      });

      if (requireEmailVerification) {
        const verifyUrl = `${req.protocol}://${req.get("host")}/api/auth/verify?token=${verificationToken}`;
        await sendEmail(email, "Verify your account", `Click <a href="${verifyUrl}">here</a> to verify your account.`);
      }

      res.status(201).json({
        message: requireEmailVerification
          ? "User created, verification email sent"
          : "User created"
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

router.get("/verify", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Token missing" });
  try {
    const user = await findUserByVerificationToken(token);
    if (!user) return res.status(400).json({ error: "Invalid or expired token" });
    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationExpires = undefined;
    await saveUser(user);
    res.json({ message: "Email verified successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/signin", async (req, res) => {
    const { email, password } = req.body || {};
    if (!isEmail(email)) return validationError(res, "Valid email required");
    if (!password) return validationError(res, "Password required");

    try {
      const user = await findUserByEmail(email);
      if (!user) return res.status(401).json({ error: "Invalid credentials" });
      if (!user.isVerified) return res.status(403).json({ error: "Email not verified" });
      if (user.isActive === false) return res.status(403).json({ error: "Account is disabled" });
      const valid = await validatePassword(user, password);
      if (!valid) {
        await recordAudit({
          source: "system",
          action: "auth.signin_failed",
          entityType: "user",
          entityId: String(user._id),
          summary: `Failed password sign-in for ${maskEmail(user.email)}`
        });
        return res.status(401).json({ error: "Invalid credentials" });
      }

      startSession(res, user);
      await recordAudit({
        actor: toActor(user),
        action: "auth.signin",
        entityType: "user",
        entityId: String(user._id),
        summary: `${user.email} signed in with a password`,
        meta: { method: "password" }
      });
      res.json({ message: "Signed in", user: await serializeWithCompany(user) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// Passwordless sign-in: a 6-digit code is emailed, valid for 10 minutes, single use,
// at most 5 guesses, one email per minute. The response never reveals whether an account exists.
router.post("/otp/request", async (req, res) => {
  const { email } = req.body || {};
  if (!isEmail(email)) return validationError(res, "Valid email required");
  const generic = { message: "If that email has an account, a sign-in code was sent" };

  try {
    const user = await findUserByEmail(email);
    if (user && user.isVerified && user.isActive !== false) {
      const lastSent = user.otpSentAt ? new Date(user.otpSentAt).getTime() : 0;
      if (Date.now() - lastSent >= OTP_COOLDOWN_MS) {
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
        user.otpHash = otpDigest(String(user._id), code);
        user.otpExpires = new Date(Date.now() + OTP_TTL_MS);
        user.otpAttempts = 0;
        user.otpSentAt = new Date();
        await saveUser(user);
        // Not awaited, so response time does not reveal whether the account exists.
        void sendEmail(
          user.email,
          "Your TalentOS sign-in code",
          `<p>Your sign-in code is <strong>${code}</strong>.</p><p>It expires in 10 minutes and can be used once. If you did not request it, you can ignore this email.</p>`
        );
      }
    }
    return res.json(generic);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/otp/verify", async (req, res) => {
  const { email, code } = req.body || {};
  if (!isEmail(email) || !/^\d{6}$/.test(String(code || ""))) {
    return validationError(res, "Valid email and 6-digit code required");
  }
  const reject = () => res.status(401).json({ error: "Invalid or expired code" });

  try {
    const user = await findUserByEmail(email);
    if (
      !user ||
      !user.isVerified ||
      user.isActive === false ||
      !user.otpHash ||
      !user.otpExpires ||
      new Date(user.otpExpires) <= new Date()
    ) {
      return reject();
    }

    const expected = Buffer.from(user.otpHash, "hex");
    const given = Buffer.from(otpDigest(String(user._id), String(code)), "hex");
    const matches = expected.length === given.length && crypto.timingSafeEqual(expected, given);

    if (!matches) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      if (user.otpAttempts >= OTP_MAX_ATTEMPTS) clearOtp(user);
      await saveUser(user);
      await recordAudit({
        source: "system",
        action: "auth.otp_failed",
        entityType: "user",
        entityId: String(user._id),
        summary: `Wrong sign-in code for ${maskEmail(user.email)}`
      });
      return reject();
    }

    clearOtp(user);
    await saveUser(user);
    startSession(res, user);
    await recordAudit({
      actor: toActor(user),
      action: "auth.signin",
      entityType: "user",
      entityId: String(user._id),
      summary: `${user.email} signed in with an email code`,
      meta: { method: "otp" }
    });
    return res.json({ message: "Signed in", user: await serializeWithCompany(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/request-reset", async (req, res) => {
    const { email } = req.body || {};
    if (!isEmail(email)) return validationError(res, "Valid email required");

    try {
      const user = await findUserByEmail(email);
      if (!user) return res.status(200).json({ message: "If that email exists, a reset link was sent" }); // ambiguous

      const resetToken = crypto.randomBytes(32).toString("hex");
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1h
      user.resetToken = resetToken;
      user.resetExpires = resetExpires;
      await saveUser(user);

      const resetUrl = `${clientUrl}/resetpassword?token=${resetToken}`;
      void sendEmail(email, "Password Reset", `Click <a href="${resetUrl}">here</a> to reset your password.`);

      res.json({ message: "If that email exists, a reset link was sent" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

async function resetPassword(req, res) {
    const { token, newPassword } = req.body || {};
    if (!token) return validationError(res, "Reset token required");
    if (!isStrongPassword(newPassword)) {
      return validationError(res, "Password must be at least 8 characters and include an uppercase letter and number");
    }

    try {
      const user = await findUserByResetToken(token);
      if (!user) return res.status(400).json({ error: "Invalid or expired token" });
      if (typeof user.setPassword === "function") {
        await user.setPassword(newPassword);
      } else {
        user.passwordHash = await hashPassword(newPassword);
      }
      user.resetToken = undefined;
      user.resetExpires = undefined;
      await saveUser(user);
      await recordAudit({
        actor: toActor(user),
        action: "auth.password_reset",
        entityType: "user",
        entityId: String(user._id),
        summary: `${user.email} reset their password with an emailed link`
      });
      res.json({ message: "Password reset successful" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
}

router.post("/reset", resetPassword);
router.post("/reset-password", resetPassword);

router.put("/profile", async (req, res) => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const {
    name,
    role,
    phone,
    profilePic,
    socialLinks
  } = req.body || {};

  if (!String(name || "").trim()) {
    return validationError(res, "Name required");
  }

  try {
    user.name = String(name).trim();
    user.role = String(role || "").trim();
    user.phone = String(phone || "").trim();
    user.profilePic = String(profilePic || "").trim();
    user.socialLinks = {
      facebook: String(socialLinks?.facebook || "").trim(),
      twitter: String(socialLinks?.twitter || "").trim()
    };

    await saveUser(user);
    return res.json({ message: "Profile updated", user: await serializeWithCompany(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/change-password", async (req, res) => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword) {
    return validationError(res, "Current password required");
  }
  if (!isStrongPassword(newPassword)) {
    return validationError(res, "Password must be at least 8 characters and include an uppercase letter and number");
  }

  try {
    const isValidCurrentPassword = await validatePassword(user, currentPassword);
    if (!isValidCurrentPassword) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    if (typeof user.setPassword === "function") {
      await user.setPassword(newPassword);
    } else {
      user.passwordHash = await hashPassword(newPassword);
      user.updatedAt = new Date();
    }

    await saveUser(user);
    await recordAudit({
      actor: toActor(user),
      action: "auth.password_changed",
      entityType: "user",
      entityId: String(user._id),
      summary: `${user.email} changed their password`
    });
    return res.json({ message: "Password changed successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/me", async (req, res) => {
  const token = getCookie(req, "auth_token") || req.headers["authorization"]?.replace(/^Bearer\s+/, "");
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Invalid token" });
  try {
    const user = await findUserById(payload.id);
    if (!user || user.isActive === false) return res.status(401).json({ error: "Not authenticated" });
    res.json({ user: await serializeWithCompany(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/logout", async (req, res) => {
  const token = getCookie(req, "auth_token") || req.headers["authorization"]?.replace(/^Bearer\s+/, "");
  const payload = token ? verifyToken(token) : null;
  if (payload?.id) {
    const user = await findUserById(payload.id).catch(() => null);
    if (user) {
      await recordAudit({
        actor: toActor(user),
        action: "auth.signout",
        entityType: "user",
        entityId: String(user._id),
        summary: `${user.email} signed out`
      });
    }
  }
  res.clearCookie("auth_token", authCookieOptions());
  res.json({ message: "Signed out" });
});

export default router;
