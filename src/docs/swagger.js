const swaggerJsdoc = require("swagger-jsdoc");
const platformSchemas = require("./schemas/platform.schema");
const financialSchemas = require("./schemas/financial.schema");

const options = {
  definition: {
    openapi: "3.0.3",

    info: {
      title: "Expense Manager API",
      version: "1.0.0",
      description:
        "REST API for Expense Manager with AI-powered financial insights.",
    },

    servers: [
      {
        url: "http://localhost:3001",
        description: "Development Server",
      },
    ],

    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        ...platformSchemas,
        ...financialSchemas,
      },
    },
  },

  apis: ["./src/docs/paths/*.js"],
};

module.exports = swaggerJsdoc(options);
