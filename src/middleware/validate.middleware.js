const validate = ({ body, query, params }) => {
  return (req, res, next) => {
    const validationErrors = [];

    if (body) {
      const result = body.safeParse(req.body);

      if (!result.success) {
        validationErrors.push(
          ...result.error.issues.map((issue) => ({
            field: `body.${issue.path.join(".")}`,
            message: issue.message,
          }))
        );
      } else {
        req.body = result.data;
      }
    }

    if (query) {
      const result = query.safeParse(req.query);

      if (!result.success) {
        validationErrors.push(
          ...result.error.issues.map((issue) => ({
            field: `query.${issue.path.join(".")}`,
            message: issue.message,
          }))
        );
      } else {
        req.query = result.data;
      }
    }

    if (params) {
      const result = params.safeParse(req.params);

      if (!result.success) {
        validationErrors.push(
          ...result.error.issues.map((issue) => ({
            field: `params.${issue.path.join(".")}`,
            message: issue.message,
          }))
        );
      } else {
        req.params = result.data;
      }
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validationErrors,
      });
    }

    next();
  };
};

module.exports = validate;