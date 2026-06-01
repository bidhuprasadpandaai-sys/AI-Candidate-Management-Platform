import express from "express";
import crypto from "crypto";
import { promisify } from "node:util";
import mongoose from "mongoose";
import { User } from "../models/User.js";
import { sendEmail } from "../utils/email.js";
import { signToken, verifyToken } from "../utils/jwt.js";

const router = express.Router();
const requireEmailVerification = process.env.REQUIRE_EMAIL_VERIFICATION === "true";
const clientUrl = process.env.CLIENT_URL || "http://localhost:4410";
const scryptAsync = promisify(crypto.scrypt);
const memoryUsers = [];

function isDatabaseReady() {
  return mongoose.connection.readyState === 1;
}

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

async function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scryptAsync(plain, salt, 64);
  return `scrypt:${salt}:${hash.toString("hex")}`;
}

async function validatePassword(user, plain) {
  if (typeof user.validatePassword === "function") {
    return user.validatePassword(plain);
  }

  const [algorithm, salt, storedHash] = String(user.passwordHash || "").split(":");
  if (algorithm !== "scrypt" || !salt || !storedHash) {
    return false;
  }

  const candidateHash = await scryptAsync(plain, salt, 64);
  const storedBuffer = Buffer.from(storedHash, "hex");

  if (storedBuffer.length !== candidateHash.length) {
    return false;
  }

  return crypto.timingSafeEqual(storedBuffer, candidateHash);
}

async function findUserByEmail(email) {
  if (isDatabaseReady()) {
    return User.findOne({ email });
  }

  return memoryUsers.find((user) => user.email === String(email).toLowerCase()) || null;
}

async function findUserByVerificationToken(token) {
  if (isDatabaseReady()) {
    return User.findOne({ verificationToken: token, verificationExpires: { $gt: new Date() } });
  }

  return memoryUsers.find((user) => {
    return user.verificationToken === token && new Date(user.verificationExpires) > new Date();
  }) || null;
}

async function findUserByResetToken(token) {
  if (isDatabaseReady()) {
    return User.findOne({ resetToken: token, resetExpires: { $gt: new Date() } });
  }

  return memoryUsers.find((user) => {
    return user.resetToken === token && new Date(user.resetExpires) > new Date();
  }) || null;
}

async function findUserById(id) {
  if (isDatabaseReady()) {
    return User.findById(id).select("-passwordHash -verificationToken -verificationExpires -resetToken -resetExpires");
  }

  const user = memoryUsers.find((item) => item._id === id);
  if (!user) {
    return null;
  }

  const { passwordHash, verificationToken, verificationExpires, resetToken, resetExpires, ...safeUser } = user;
  return safeUser;
}

async function saveUser(user) {
  if (typeof user.save === "function") {
    await user.save();
  }
  return user;
}

async function createUser({ email, password, name, role, phone, verificationToken, verificationExpires }) {
  if (isDatabaseReady()) {
    const user = new User({
      email,
      name,
      role,
      phone,
      isVerified: !requireEmailVerification,
      verificationToken: requireEmailVerification ? verificationToken : undefined,
      verificationExpires: requireEmailVerification ? verificationExpires : undefined
    });
    await user.setPassword(password);
    await user.save();
    return user;
  }

  const user = {
    _id: `memory-user-${Date.now()}`,
    email: String(email).toLowerCase(),
    name,
    role,
    phone,
    profilePic: "",
    socialLinks: {
      facebook: "",
      twitter: ""
    },
    isVerified: !requireEmailVerification,
    verificationToken: requireEmailVerification ? verificationToken : undefined,
    verificationExpires: requireEmailVerification ? verificationExpires : undefined,
    passwordHash: await hashPassword(password),
    createdAt: new Date(),
    updatedAt: new Date()
  };
  memoryUsers.push(user);
  return user;
}

function serializeUser(user) {
  return {
    id: String(user._id),
    email: user.email,
    name: user.name,
    role: user.role,
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

  if (isDatabaseReady()) {
    return User.findById(payload.id);
  }

  return memoryUsers.find((item) => item._id === payload.id) || null;
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

      await createUser({ email, password, name, role, phone, verificationToken, verificationExpires });

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
      const valid = await validatePassword(user, password);
      if (!valid) return res.status(401).json({ error: "Invalid credentials" });

      const token = signToken({ id: user._id, email: user.email, role: user.role });
      res.cookie("auth_token", token, authCookieOptions());
      res.json({ message: "Signed in", user: serializeUser(user) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

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
      await sendEmail(email, "Password Reset", `Click <a href="${resetUrl}">here</a> to reset your password.`);

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

    if (!isDatabaseReady()) {
      user.updatedAt = new Date();
      if (!user.createdAt) {
        user.createdAt = new Date();
      }
    }

    await saveUser(user);
    return res.json({ message: "Profile updated", user: serializeUser(user) });
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
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/logout", (_req, res) => {
  res.clearCookie("auth_token", authCookieOptions());
  res.json({ message: "Signed out" });
});

export default router;
