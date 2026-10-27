const { sendSuccess } = require("../utiles/response");
const asyncHandler = require("../middleware/asyncHandler");
const UserService = require("../services/user.service");

const GetAllusers = asyncHandler(async (req, res) => {
  const users = await UserService.getAllUsers();
  return sendSuccess(res, 200, "users found successfully", users);
});

const GetuserbyId = asyncHandler(async (req, res) => {
  const user = await UserService.getUserById(req.params.id);
  return sendSuccess(res, 200, "User found successfully", user);
});

const DeleteUser = asyncHandler(async (req, res) => {
  await UserService.deleteUser(req.params.id);
  return sendSuccess(res, 200, "User delete successfully");
});

const SignupUser = asyncHandler(async (req, res) => {
  // Hash the password before saving so we never store plain text
  const user = await UserService.signupUser(req.body);
  return sendSuccess(res, 201, "User created successfully", {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
  });
});

const LoginUser = asyncHandler(async (req, res) => {
  const result = await UserService.loginUser(req.body);

  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
  };

  res.cookie("accessToken", result.accessToken, {
    ...cookieOptions,
    maxAge: 3600000,
  });

  res.cookie("refreshToken", result.refreshToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  return sendSuccess(res, 200, "Login Successfully", {
    token: result.accessToken,
    user: result.user,
  });
});


const RefreshToken = asyncHandler(async (req, res) => {
  const newAccessToken = await UserService.refreshToken(
    req.cookies.refreshToken
  );

  res.cookie("accessToken", newAccessToken, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: 3600000,
  });

  return sendSuccess(res, 200, "Token refreshed", {
    token: newAccessToken,
  });
});



const LogoutUser = asyncHandler(async (req, res) => {
  await UserService.revokeRefreshToken(req.cookies?.refreshToken);

  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
  };

  res.clearCookie("accessToken", cookieOptions);
  res.clearCookie("refreshToken", cookieOptions);

  return sendSuccess(res, 200, "Logged out successfully");
});


const UpdateUser = asyncHandler(async (req, res) => {
  const updatedUser = await UserService.updateUser(req.params.id,req.body);
    return sendSuccess(res, 200, "User updated successfully", updatedUser);
});



//Util function to upload profile picture to s3
const UploadProfilePic = asyncHandler(async (req, res) => {
  const updatedUser = await UserService.uploadProfilePicture(req.params.id,req.file);  
    return sendSuccess(
      res,
      200,
      "Profile Image Uploaded Successfully",
      updatedUser,
    )
});

module.exports = {
  GetAllusers,
  GetuserbyId,
  DeleteUser,
  SignupUser,
  LoginUser,
  RefreshToken,
  LogoutUser,
  UpdateUser,
  UploadProfilePic,
};
