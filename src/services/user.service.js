const UserModel = require("../models/UserModel");
const crypto = require("crypto")
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const s3 = require("../config/s3");
const NotFoundError = require("../errors/NotFoundError");
const ConflictError = require("../errors/ConflictError");
const UnauthorizedError = require("../errors/UnauthorizedError");
const ValidationError = require("../errors/ValidationError");

const extractS3Key = (url) => {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname.substring(1);
  } catch {
    return null;
  }
};

const getAllUsers = async () => {
  return UserModel.find().select("-password");
};

const getUserById = async (id) => {
  const user = await UserModel.findById(id).select("-password");
  if (!user) {
    throw new NotFoundError("User not found");
  }
  return user;
};

const deleteUser = async (id) => {
  const user = await UserModel.findByIdAndDelete(id);
  if (!user) throw new NotFoundError("User not found");
  return user;
};

const signupUser = async (data) => {
  const existingUser = await UserModel.findOne({ email: data.email });
  if (existingUser) {
    throw new ConflictError("Email already Registered");
  }
  const salt = bcrypt.genSaltSync(10);
  const hashedPassword = bcrypt.hashSync(data.password, salt);
  const user = await UserModel.create({
    name: data.name,
    email: data.email,
    password: hashedPassword,
    role: "User",
  });
  return user;
};

const loginUser = async (data) => {
  const { email, password } = data;

  const foundUser = await UserModel.findOne({ email });
  if (!foundUser) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const isMatch = await bcrypt.compare(password, foundUser.password);
  if (!isMatch) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const accessToken = jwt.sign(
    { id: foundUser._id, role: foundUser.role },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );

  const refreshToken = jwt.sign(
    { id: foundUser._id },
    process.env.REFRESH_SECRET,
    { expiresIn: "7d" },
  );

  const userData = foundUser.toObject();
  delete userData.password;
  return {
    accessToken,
    refreshToken,
    user: userData,
  };
};

const refreshToken = async (token) => {
  if (!token) {
    throw new UnauthorizedError("Refresh token missing");
  }

  let decoded;

  try {
    decoded = jwt.verify(token, process.env.REFRESH_SECRET);
  } catch {
    throw new UnauthorizedError("Invalid refresh token");
  }

  const user = await UserModel.findById(decoded.id);

  if (!user) {
    throw new UnauthorizedError("User not found");
  }

  const newAccessToken = jwt.sign(
    {
      id: user._id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "1h",
    },
  );

  return newAccessToken;
};

const updateUser = async (id, data) => {
  const { name, email, bio, profilePic } = data;

  const updatedUser = await UserModel.findByIdAndUpdate(
    id,
    { name, email, bio, profilePic },
    { new: true, runValidators: true },
  ).select("-password");

  if (!updatedUser) {
    throw new NotFoundError("User not found");
  }

  return updatedUser;
};

const uploadProfilePicture = async (id, file) => {
  if (!file) {
    throw new ValidationError("No file uploaded");
  }
  const currentUser = await UserModel.findById(id);
  if (!currentUser) {
    throw new NotFoundError("User not found");
  }

  if (currentUser.profilePic) {
    const oldKey = extractS3Key(currentUser.profilePic);
    if (oldKey) {
      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: oldKey,
          }),
        );
      } catch (deleteErr) {
        console.error(
          "Failed to delete old profile pic from S3:",
          deleteErr.message,
        );
      }
    }
  }

  const extensionByMimeType = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };

  const extension = extensionByMimeType[file.mimetype];

  if (!extension) {
    throw new ValidationError("Unsupported profile image type");
  }

  const fileName = `profiles/${crypto.randomUUID()}.${extension}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
    }),
  );
  const imageUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;

  const updatedUser = await UserModel.findByIdAndUpdate(
    id,
    {
      profilePic: imageUrl,
    },
    { new: true, runValidators: true },
  ).select("-password");

  return updatedUser;
};
module.exports = {
  getAllUsers,
  getUserById,
  deleteUser,
  signupUser,
  loginUser,
  refreshToken,
  updateUser,
  uploadProfilePicture,
};
