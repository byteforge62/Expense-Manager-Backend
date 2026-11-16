
const routes = require("express").Router();
const UserController = require("../Controllers/UserController");
const {
  requireAuth,
  requireRole,
} = require("../middleware/auth.middleware");
const { upload, validateImageSignature } = require("../middleware/upload.middleware");
const validate = require("../middleware/validate.middleware");
const {
  signupSchema,
  loginSchema,
  updateUserSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} = require("../validations/user.validation");
const {idParamSchema} = require("../validations/common.validation");

const requireSelfOrAdmin = (req, res, next) => {
  if (
    String(req.params.id) !== String(req.user.id) &&
    req.user.role !== "Admin"
  ) {
    return res.status(403).json({
      success: false,
      message: "You are not authorized to access this account",
    });
  }

  next();
};

routes.post(
  "/user",
  validate({body:signupSchema}),
  UserController.SignupUser
);
routes.post(
  "/user/login",
  validate({body:loginSchema}),
  UserController.LoginUser
);
routes.post("/user/refresh-token", UserController.RefreshToken);
routes.post("/user/logout", UserController.LogoutUser);

// Password recovery. Both endpoints are unauthenticated by design: the user
// has no session yet, and the reset token itself is the credential.
routes.post(
  "/user/forgotpassword",
  validate({ body: forgotPasswordSchema }),
  UserController.ForgotPassword,
);

routes.post(
  "/user/resetpassword",
  validate({ body: resetPasswordSchema }),
  UserController.ResetPassword,
);

routes.get(
  "/users",
  requireAuth,
  requireRole("Admin"),
  UserController.GetAllusers
);

routes.get(
  "/user/:id",
  requireAuth,
  requireSelfOrAdmin,
  validate({params: idParamSchema}),
  UserController.GetuserbyId
);

routes.put(
  "/user/:id",
  requireAuth,
  requireSelfOrAdmin,
  validate({ 
    params: idParamSchema,
    body: updateUserSchema 
  }),
  UserController.UpdateUser,
);

routes.delete(
  "/user/:id",
  requireAuth,
  requireRole("Admin"),
  validate({params: idParamSchema}),
  UserController.DeleteUser
);

routes.post(
  "/user/upload-profile/:id",
  requireAuth,
  requireSelfOrAdmin,
  validate({params: idParamSchema}),
  upload.single("profilePic"),
  validateImageSignature,
  UserController.UploadProfilePic
);

module.exports = routes;
