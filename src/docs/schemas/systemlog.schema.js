module.exports = {
  SystemLog: {
    type: "object",
    properties: {
      _id: {
        type: "string",
      },
      user: {
        type: "string",
      },
      action: {
        type: "string",
        example: "CREATE_EXPENSE",
      },
      description: {
        type: "string",
        example: "User created a new expense.",
      },
      createdAt: {
        type: "string",
        format: "date-time",
      },
      updatedAt: {
        type: "string",
        format: "date-time",
      },
    },
  },
};
