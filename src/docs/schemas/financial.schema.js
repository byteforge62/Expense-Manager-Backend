/**
 * OpenAPI component schemas: expenses, income, transactions, bills, budgets, categories, reports.
 *
 * Registered by src/docs/swagger.js; one module per audience so a new endpoint
 * adds to an existing file instead of creating another fragment.
 */

module.exports = {
  "Expense": {
    "type": "object",
    "properties": {
      "_id": {
        "type": "string",
        "example": "68824e0c9b5f3dbfd03ad123"
      },
      "title": {
        "type": "string",
        "example": "Grocery Shopping"
      },
      "amount": {
        "type": "number",
        "example": 850
      },
      "categoryID": {
        "type": "string",
        "example": "68824e0c9b5f3dbfd03ad456"
      },
      "userID": {
        "type": "string",
        "example": "68824e0c9b5f3dbfd03ad789"
      },
      "date": {
        "type": "string",
        "format": "date",
        "example": "2026-07-25"
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
  "CreateExpenseRequest": {
    "type": "object",
    "required": [
      "title",
      "amount",
      "categoryID",
      "date"
    ],
    "properties": {
      "title": {
        "type": "string",
        "example": "Grocery Shopping"
      },
      "amount": {
        "type": "number",
        "example": 850
      },
      "categoryID": {
        "type": "string",
        "example": "68824e0c9b5f3dbfd03ad456"
      },
      "date": {
        "type": "string",
        "format": "date",
        "example": "2026-07-25"
      }
    }
  },
  "UpdateExpenseRequest": {
    "type": "object",
    "properties": {
      "title": {
        "type": "string",
        "example": "Monthly Grocery"
      },
      "amount": {
        "type": "number",
        "example": 950
      },
      "categoryID": {
        "type": "string",
        "example": "68824e0c9b5f3dbfd03ad456"
      },
      "date": {
        "type": "string",
        "format": "date",
        "example": "2026-07-26"
      }
    }
  },
  "Income": {
    "type": "object",
    "properties": {
      "_id": {
        "type": "string",
        "example": "68824e0c9b5f3dbfd03ad123"
      },
      "title": {
        "type": "string",
        "example": "Monthly Salary"
      },
      "amount": {
        "type": "number",
        "example": 45000
      },
      "categoryID": {
        "type": "string",
        "example": "68824e0c9b5f3dbfd03ad456"
      },
      "userID": {
        "type": "string",
        "example": "68824e0c9b5f3dbfd03ad789"
      },
      "date": {
        "type": "string",
        "format": "date",
        "example": "2026-07-25"
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
  "CreateIncomeRequest": {
    "type": "object",
    "required": [
      "title",
      "amount",
      "categoryID",
      "date"
    ],
    "properties": {
      "title": {
        "type": "string",
        "example": "Monthly Salary"
      },
      "amount": {
        "type": "number",
        "example": 45000
      },
      "categoryID": {
        "type": "string",
        "example": "68824e0c9b5f3dbfd03ad456"
      },
      "date": {
        "type": "string",
        "format": "date",
        "example": "2026-07-25"
      }
    }
  },
  "Transaction": {
    "type": "object",
    "properties": {
      "_id": {
        "type": "string",
        "example": "68824e0c9b5f3dbfd03ad123"
      },
      "userID": {
        "type": "string",
        "example": "68824e0c9b5f3dbfd03ad456"
      },
      "type": {
        "type": "string",
        "enum": [
          "Income",
          "Expense"
        ],
        "example": "Expense"
      },
      "amount": {
        "type": "number",
        "example": 1200
      },
      "date": {
        "type": "string",
        "format": "date",
        "example": "2026-07-25"
      },
      "description": {
        "type": "string",
        "example": "Dinner with friends"
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
  "CreateTransactionRequest": {
    "type": "object",
    "required": [
      "type",
      "amount"
    ],
    "properties": {
      "type": {
        "type": "string",
        "enum": [
          "Income",
          "Expense"
        ],
        "example": "Expense"
      },
      "amount": {
        "type": "number",
        "example": 1200
      },
      "date": {
        "type": "string",
        "format": "date",
        "example": "2026-07-25"
      },
      "description": {
        "type": "string",
        "example": "Dinner with friends"
      }
    }
  },
  "Bill": {
    "type": "object",
    "properties": {
      "_id": {
        "type": "string",
        "example": "68824e0c9b5f3dbfd03ad123"
      },
      "userID": {
        "type": "string",
        "example": "68824e0c9b5f3dbfd03ad456"
      },
      "name": {
        "type": "string",
        "example": "Electricity Bill"
      },
      "dueDate": {
        "type": "string",
        "format": "date",
        "example": "2026-07-31"
      },
      "amount": {
        "type": "number",
        "example": 2500
      },
      "status": {
        "type": "string",
        "enum": [
          "pending",
          "paid"
        ],
        "example": "pending"
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
  "CreateBillRequest": {
    "type": "object",
    "required": [
      "name",
      "dueDate",
      "amount"
    ],
    "properties": {
      "name": {
        "type": "string",
        "example": "Electricity Bill"
      },
      "dueDate": {
        "type": "string",
        "format": "date",
        "example": "2026-07-31"
      },
      "amount": {
        "type": "number",
        "example": 2500
      },
      "status": {
        "type": "string",
        "enum": [
          "pending",
          "paid"
        ],
        "example": "pending"
      }
    }
  },
  "Budget": {
    "type": "object",
    "properties": {
      "_id": {
        "type": "string",
        "example": "68824e0c9b5f3dbfd03ad123"
      },
      "userID": {
        "type": "string",
        "example": "68824e0c9b5f3dbfd03ad456"
      },
      "categoryID": {
        "type": "string",
        "example": "68824e0c9b5f3dbfd03ad789"
      },
      "amount": {
        "type": "number",
        "example": 10000
      },
      "start_date": {
        "type": "string",
        "format": "date",
        "example": "2026-07-01"
      },
      "end_date": {
        "type": "string",
        "format": "date",
        "example": "2026-07-31"
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
  "CreateBudgetRequest": {
    "type": "object",
    "required": [
      "categoryID",
      "amount",
      "start_date",
      "end_date"
    ],
    "properties": {
      "categoryID": {
        "type": "string",
        "example": "68824e0c9b5f3dbfd03ad789"
      },
      "amount": {
        "type": "number",
        "example": 10000
      },
      "start_date": {
        "type": "string",
        "format": "date",
        "example": "2026-07-01"
      },
      "end_date": {
        "type": "string",
        "format": "date",
        "example": "2026-07-31"
      }
    }
  },
  "Category": {
    "type": "object",
    "properties": {
      "_id": {
        "type": "string",
        "example": "68824e0c9b5f3dbfd03ad123"
      },
      "name": {
        "type": "string",
        "example": "Food"
      },
      "type": {
        "type": "string",
        "example": "expense"
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
  "CreateCategoryRequest": {
    "type": "object",
    "required": [
      "name",
      "type"
    ],
    "properties": {
      "name": {
        "type": "string",
        "example": "Food"
      },
      "type": {
        "type": "string",
        "example": "expense"
      }
    }
  },
  "ReportResponse": {
    "type": "string",
    "format": "binary",
    "description": "Generated PDF financial report"
  }
};
