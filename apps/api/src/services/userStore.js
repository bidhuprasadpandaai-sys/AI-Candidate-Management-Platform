import crypto from "node:crypto";
import { promisify } from "node:util";
import mongoose from "mongoose";
import { ROLES, effectiveRole } from "@acmp/shared";
import { User } from "../models/User.js";

const scryptAsync = promisify(crypto.scrypt);
export const memoryUsers = [];

const SAFE_SELECT = "-passwordHash -verificationToken -verificationExpires -resetToken -resetExpires -otpHash -otpExpires -otpAttempts -otpSentAt";
const SECRET_FIELDS = ["passwordHash", "verificationToken", "verificationExpires", "resetToken", "resetExpires", "otpHash", "otpExpires", "otpAttempts", "otpSentAt"];

export function isDatabaseReady() {
  return mongoose.connection.readyState === 1;
}

export async function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scryptAsync(plain, salt, 64);
  return `scrypt:${salt}:${hash.toString("hex")}`;
}

export async function validatePassword(user, plain) {
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

export async function findUserByEmail(email) {
  const normalized = String(email).trim().toLowerCase();
  if (isDatabaseReady()) {
    return User.findOne({ email: normalized });
  }

  return memoryUsers.find((user) => user.email === normalized) || null;
}

export async function findUserByVerificationToken(token) {
  if (isDatabaseReady()) {
    return User.findOne({ verificationToken: token, verificationExpires: { $gt: new Date() } });
  }

  return memoryUsers.find((user) => {
    return user.verificationToken === token && new Date(user.verificationExpires) > new Date();
  }) || null;
}

export async function findUserByResetToken(token) {
  if (isDatabaseReady()) {
    return User.findOne({ resetToken: token, resetExpires: { $gt: new Date() } });
  }

  return memoryUsers.find((user) => {
    return user.resetToken === token && new Date(user.resetExpires) > new Date();
  }) || null;
}

// Full document (with secrets) by id, for flows that modify the user.
export async function findUserDocById(id) {
  if (isDatabaseReady()) {
    return mongoose.isValidObjectId(id) ? User.findById(id) : null;
  }
  return memoryUsers.find((item) => item._id === id) || null;
}

// Plain object without secret fields.
export async function findUserById(id) {
  if (isDatabaseReady()) {
    if (!mongoose.isValidObjectId(id)) return null;
    return User.findById(id).select(SAFE_SELECT).lean();
  }

  const user = memoryUsers.find((item) => item._id === id);
  if (!user) {
    return null;
  }

  const safeUser = { ...user };
  for (const field of SECRET_FIELDS) delete safeUser[field];
  return safeUser;
}

export async function listUsers() {
  if (isDatabaseReady()) {
    return User.find({}).select(SAFE_SELECT).sort({ createdAt: 1 }).lean();
  }
  return memoryUsers.map((user) => {
    const safeUser = { ...user };
    for (const field of SECRET_FIELDS) delete safeUser[field];
    return safeUser;
  });
}

export async function countUsers() {
  return isDatabaseReady() ? User.countDocuments({}) : memoryUsers.length;
}

export async function saveUser(user) {
  if (typeof user.save === "function") {
    await user.save();
  } else {
    user.updatedAt = new Date();
  }
  return user;
}

export function defaultAccessRoleFor(email, isFirstUser, env = process.env) {
  const admins = String(env.ADMIN_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (admins.includes(String(email).trim().toLowerCase()) || isFirstUser) return "admin";
  const configured = String(env.DEFAULT_ROLE || "viewer").trim().toLowerCase();
  return ROLES.includes(configured) && configured !== "admin" ? configured : "viewer";
}

export async function createUser({ email, password, name, role, phone, verificationToken, verificationExpires, requireEmailVerification }) {
  const isFirstUser = (await countUsers()) === 0;
  const accessRole = defaultAccessRoleFor(email, isFirstUser);

  if (isDatabaseReady()) {
    const user = new User({
      email,
      name,
      role,
      phone,
      accessRole,
      isVerified: !requireEmailVerification,
      verificationToken: requireEmailVerification ? verificationToken : undefined,
      verificationExpires: requireEmailVerification ? verificationExpires : undefined
    });
    await user.setPassword(password);
    await user.save();
    return user;
  }

  const user = {
    _id: `memory-user-${crypto.randomUUID()}`,
    email: String(email).toLowerCase(),
    name,
    role,
    phone,
    accessRole,
    companyId: null,
    isActive: true,
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

// What the rest of the API needs to know about the signed-in user.
export function toActor(user) {
  return {
    id: String(user._id ?? user.id),
    email: user.email,
    name: user.name,
    accessRole: effectiveRole(user),
    companyId: user.companyId ? String(user.companyId) : null
  };
}
