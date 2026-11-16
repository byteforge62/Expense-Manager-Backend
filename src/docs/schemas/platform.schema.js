/**
 * OpenAPI component schemas: shared envelopes, users, system logs, AI.
 *
 * Registered by src/docs/swagger.js; one module per audience so a new endpoint
 * adds to an existing file instead of creating another fragment.
 */

module.exports = {
  "SuccessResponse": {
    "type": "object",
    "properties": {
      "success": {
        "type": "boolean",
        "example": true
      },
      "message": {
        "type": "string",
        "example": "Operation completed successfully"
      }
    }
  },
  "ErrorResponse": {
    "type": "object",
    "properties": {
      "success": {
        "type": "boolean",
        "example": false
      },
      "message": {
        "type": "string",
        "example": "Something went wrong"
      }
    }
  },
  "SignupRequest": {
    "type": "object",
    "required": [
      "name",
      "email",
      "password"
    ],
    "properties": {
      "name": {
        "type": "string",
        "example": "Muhammad Patel"
      },
      "email": {
        "type": "string",
        "format": "email",
        "example": "patel@gmail.com"
      },
      "password": {
        "type": "string",
        "format": "password",
        "example": "Password123"
      }
    }
  },
  "LoginRequest": {
    "type": "object",
    "required": [
      "email",
      "password"
    ],
    "properties": {
      "email": {
        "type": "string",
        "format": "email",
        "example": "patel@gmail.com"
      },
      "password": {
        "type": "string",
        "format": "password",
        "example": "Password123"
      }
    }
  },
  "User": {
    "type": "object",
    "properties": {
      "_id": {
        "type": "string",
        "example": "6880aabbccddeeff00112233"
      },
      "name": {
        "type": "string",
        "example": "Muhammad Patel"
      },
      "email": {
        "type": "string",
        "example": "patel@gmail.com"
      },
      "role": {
        "type": "string",
        "example": "User"
      },
      "profilePic": {
        "type": "string",
        "example": ""
      },
      "is_active": {
        "type": "boolean",
        "example": true
      }
    }
  },
  "SystemLog": {
    "type": "object",
    "properties": {
      "_id": {
        "type": "string"
      },
      "user": {
        "type": "string"
      },
      "action": {
        "type": "string",
        "example": "CREATE_EXPENSE"
      },
      "description": {
        "type": "string",
        "example": "User created a new expense."
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    }
  },
  "AIChatRequest": {
    "type": "object",
    "required": [
      "message"
    ],
    "properties": {
      "message": {
        "type": "string",
        "example": "How can I reduce my monthly expenses?"
      }
    }
  },
  "AIReply": {
    "type": "object",
    "properties": {
      "reply": {
        "type": "string",
        "example": "Based on your spending history, reducing restaurant expenses could save approximately 15% each month."
      }
    }
  },
  "ExpenseInsights": {
    "type": "object",
    "properties": {
      "insights": {
        "type": "string",
        "example": "Your food expenses increased by 18% compared to last month."
      }
    }
  },
  "BudgetPlan": {
    "type": "object",
    "properties": {
      "budgetPlan": {
        "type": "string",
        "example": "Allocate 50% to needs, 30% to wants, and 20% to savings."
      }
    }
  },
  "SpendingRisk": {
    "type": "object",
    "properties": {
      "risk": {
        "type": "string",
        "example": "High risk of exceeding your entertainment budget this month."
      }
    }
  },
  "FinancialForecast": {
    "type": "object",
    "properties": {
      "forecast": {
        "type": "string",
        "example": "At your current spending rate, your savings will grow by approximately 8% this quarter."
      }
    }
  },
  "SavingOpportunities": {
    "type": "object",
    "properties": {
      "opportunities": {
        "type": "string",
        "example": "Switching to a lower-cost subscription plan could save you $20 per month."
      }
    }
  },
  "FinancialHealthScore": {
    "type": "object",
    "properties": {
      "score": {
        "type": "number",
        "example": 84
      },
      "rating": {
        "type": "string",
        "example": "Excellent"
      }
    }
  }
};
