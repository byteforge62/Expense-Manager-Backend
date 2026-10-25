
const routes = require("express").Router();
const UserController = require("../Controllers/UserController");
const {
  requireAuth,
  requireRole,
} = require("../middleware/auth.middleware");
const upload = require("../middleware/upload");
const validate = require("../middleware/validate.middleware");
const validateImageSignature = require(
  "../middleware/validate-image-signature.middleware"
);
const {
  signupSchema,
  loginSchema,
} = require("../validations/user.validation");

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
  UserController.GetuserbyId
);

routes.put(
  "/user/:id",
  requireAuth,
  requireSelfOrAdmin,
  UserController.UpdateUser
);

routes.delete(
  "/user/:id",
  requireAuth,
  requireRole("Admin"),
  UserController.DeleteUser
);

routes.post(
  "/user/upload-profile/:id",
  requireAuth,
  requireSelfOrAdmin,
  upload.single("profilePic"),
  UserController.UploadProfilePic
);

routes.post(
  "/user/upload-profile/:id",
  requireAuth,
  requireSelfOrAdmin,
  upload.single("profilePic"),
  validateImageSignature,
  UserController.UploadProfilePic
);

module.exports = routes;
