import mongoose from "mongoose";
import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true },
  role: { type: String, required: false },
  phone: { type: String, required: false },
  profilePic: { type: String, required: false },
  socialLinks: {
    facebook: { type: String, required: false },
    twitter: { type: String, required: false }
  },
  isVerified: { type: Boolean, default: false },
  verificationToken: { type: String },
  verificationExpires: { type: Date },
  resetToken: { type: String },
  resetExpires: { type: Date }
}, { timestamps: true });

UserSchema.methods.setPassword = async function (plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scryptAsync(plain, salt, 64);
  this.passwordHash = `scrypt:${salt}:${hash.toString("hex")}`;
};

UserSchema.methods.validatePassword = async function (plain) {
  const [algorithm, salt, storedHash] = String(this.passwordHash || "").split(":");
  if (algorithm !== "scrypt" || !salt || !storedHash) {
    return false;
  }

  const candidateHash = await scryptAsync(plain, salt, 64);
  const storedBuffer = Buffer.from(storedHash, "hex");

  if (storedBuffer.length !== candidateHash.length) {
    return false;
  }

  return crypto.timingSafeEqual(storedBuffer, candidateHash);
};

export const User = mongoose.model("User", UserSchema);
