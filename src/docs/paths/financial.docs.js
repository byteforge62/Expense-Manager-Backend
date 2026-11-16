/**
 * @openapi
 * tags:
 *   - name: Expenses
 *     description: Expense Management APIs
 */

/**
 * @openapi
 * /api/expense:
 *   post:
 *     tags:
 *       - Expenses
 *     summary: Create a new expense
 *     description: Creates a new expense for the authenticated user.
 *     security:
 *       - bearerAuth: []
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateExpenseRequest'
 *
 *     responses:
 *       201:
 *         description: Expense created successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Expense Added successfully
 *                 data:
 *                   $ref: '#/components/schemas/Expense'
 *
 *       400:
 *         description: Validation Error
 *
 *       401:
 *         description: Unauthorized
 *
 *       500:
 *         description: Internal Server Error
 */

/**
 * @openapi
 * /api/expenses:
 *   get:
 *     tags:
 *       - Expenses
 *     summary: Get all expenses
 *     description: Returns all expenses. Accessible only by Admin users.
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Expenses fetched successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Expenses fetched successfully
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Expense'
 *
 *       401:
 *         description: Unauthorized
 *
 *       403:
 *         description: Forbidden
 *
 *       500:
 *         description: Internal Server Error
 */

/**
 * @openapi
 * /api/expenses/me:
 *   get:
 *     tags:
 *       - Expenses
 *     summary: Get logged-in user's expenses
 *     description: Returns all expenses belonging to the authenticated user with optional filters.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter expenses from this date.
 *
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter expenses until this date.
 *
 *       - in: query
 *         name: categoryID
 *         schema:
 *           type: string
 *         description: Category ID.
 *
 *       - in: query
 *         name: minAmount
 *         schema:
 *           type: number
 *         description: Minimum expense amount.
 *
 *       - in: query
 *         name: maxAmount
 *         schema:
 *           type: number
 *         description: Maximum expense amount.
 *
 *     responses:
 *       200:
 *         description: Expense found successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Expense found successfully
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Expense'
 *
 *       401:
 *         description: Unauthorized
 *
 *       500:
 *         description: Internal Server Error
 */

/**
 * @openapi
 * /api/expenses/recent:
 *   get:
 *     tags:
 *       - Expenses
 *     summary: Get recent expenses
 *     description: Returns the five most recent expenses of the authenticated user.
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Recent expenses fetched successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Recent expenses fetched successfully
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Expense'
 *
 *       401:
 *         description: Unauthorized
 *
 *       500:
 *         description: Internal Server Error
 */

/**
 * @openapi
 * /api/expense/{id}:
 *   get:
 *     tags:
 *       - Expenses
 *     summary: Get expense by ID
 *     description: Returns a single expense belonging to the authenticated user.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Expense ID
 *
 *     responses:
 *       200:
 *         description: Expense fetched successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Expense fetched successfully
 *                 data:
 *                   $ref: '#/components/schemas/Expense'
 *
 *       401:
 *         description: Unauthorized
 *
 *       403:
 *         description: Forbidden - You do not own this expense.
 *
 *       404:
 *         description: Expense not found
 *
 *       500:
 *         description: Internal Server Error
 *
 *   put:
 *     tags:
 *       - Expenses
 *     summary: Update expense
 *     description: Updates an existing expense owned by the authenticated user.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Expense ID
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateExpenseRequest'
 *
 *     responses:
 *       200:
 *         description: Expense updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Expense updated successfully
 *                 data:
 *                   $ref: '#/components/schemas/Expense'
 *
 *       400:
 *         description: Validation Error
 *
 *       401:
 *         description: Unauthorized
 *
 *       403:
 *         description: Forbidden - You do not own this expense.
 *
 *       404:
 *         description: Expense not found
 *
 *       500:
 *         description: Internal Server Error
 *
 *   delete:
 *     tags:
 *       - Expenses
 *     summary: Delete expense
 *     description: Deletes an expense owned by the authenticated user.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Expense ID
 *
 *     responses:
 *       200:
 *         description: Expense deleted successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Expense Deleted Successfully
 *
 *       401:
 *         description: Unauthorized
 *
 *       403:
 *         description: Forbidden - You do not own this expense.
 *
 *       404:
 *         description: Expense not found
 *
 *       500:
 *         description: Internal Server Error
 */

/**
 * @openapi
 * tags:
 *   - name: Income
 *     description: Income Management APIs
 */

/**
 * @openapi
 * /api/income:
 *   post:
 *     tags:
 *       - Income
 *     summary: Create income
 *     description: Creates a new income entry for the authenticated user.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateIncomeRequest'
 *     responses:
 *       201:
 *         description: Income added successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Income added successfully
 *                 data:
 *                   $ref: '#/components/schemas/Income'
 *
 *       401:
 *         description: Unauthorized
 *
 *       500:
 *         description: Internal Server Error
 */

/**
 * @openapi
 * /api/incomes:
 *   get:
 *     tags:
 *       - Income
 *     summary: Get all income
 *     description: Returns every income record. Admin only.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Income fetched successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Income'
 *
 *       403:
 *         description: Forbidden
 */

/**
 * @openapi
 * /api/incomes/me:
 *   get:
 *     tags:
 *       - Income
 *     summary: Get logged-in user's income
 *     description: Returns all income entries belonging to the authenticated user.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Income found successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Income'
 */

/**
 * @openapi
 * /api/income/{id}:
 *   get:
 *     tags:
 *       - Income
 *     summary: Get income by ID
 *     description: Returns a single income belonging to the authenticated user.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Income found successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/Income'
 *
 *       403:
 *         description: Forbidden
 *
 *       404:
 *         description: Income not found
 *
 *   delete:
 *     tags:
 *       - Income
 *     summary: Delete income
 *     description: Deletes an income entry owned by the authenticated user.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Income deleted successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                   example: Income deleted successfully
 *
 *       403:
 *         description: Forbidden
 *
 *       404:
 *         description: Income not found
 */

/**
 * @openapi
 * tags:
 *   - name: Budgets
 *     description: Budget Management APIs
 */

/**
 * @openapi
 * /api/budget:
 *   post:
 *     tags:
 *       - Budgets
 *     summary: Create budget
 *     description: Creates a new budget for the authenticated user.
 *     security:
 *       - bearerAuth: []
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateBudgetRequest'
 *
 *     responses:
 *       201:
 *         description: Budget added successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Budget added successfully
 *                 data:
 *                   $ref: '#/components/schemas/Budget'
 *
 *       401:
 *         description: Unauthorized
 *
 *       500:
 *         description: Internal Server Error
 */

/**
 * @openapi
 * /api/budgets:
 *   get:
 *     tags:
 *       - Budgets
 *     summary: Get all budgets
 *     description: Returns every budget. Admin only.
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Budgets fetched successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Budget'
 *
 *       403:
 *         description: Forbidden
 */

/**
 * @openapi
 * /api/budgets/me:
 *   get:
 *     tags:
 *       - Budgets
 *     summary: Get logged-in user's budgets
 *     description: Returns all budgets belonging to the authenticated user.
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Budget found successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Budget'
 */

/**
 * @openapi
 * /api/budget/{id}:
 *   get:
 *     tags:
 *       - Budgets
 *     summary: Get budget by ID
 *     description: Returns a single budget owned by the authenticated user.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Budget ID
 *
 *     responses:
 *       200:
 *         description: Budget found successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/Budget'
 *
 *       403:
 *         description: Forbidden
 *
 *       404:
 *         description: Budget not found
 *
 *   delete:
 *     tags:
 *       - Budgets
 *     summary: Delete budget
 *     description: Deletes a budget owned by the authenticated user.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Budget ID
 *
 *     responses:
 *       200:
 *         description: Budget deleted successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Budget deleted successfully
 *
 *       403:
 *         description: Forbidden
 *
 *       404:
 *         description: Budget not found
 */

/**
 * @openapi
 * tags:
 *   - name: Bills
 *     description: Bill Management APIs
 */

/**
 * @openapi
 * /api/bill:
 *   post:
 *     tags:
 *       - Bills
 *     summary: Create bill
 *     description: Creates a new bill for the authenticated user.
 *     security:
 *       - bearerAuth: []
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateBillRequest'
 *
 *     responses:
 *       201:
 *         description: Bill added successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Bill added successfully
 *                 data:
 *                   $ref: '#/components/schemas/Bill'
 *
 *       401:
 *         description: Unauthorized
 *
 *       500:
 *         description: Internal Server Error
 */

/**
 * @openapi
 * /api/bills:
 *   get:
 *     tags:
 *       - Bills
 *     summary: Get all bills
 *     description: Returns all bills. Admin only.
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Bills fetched successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Bill'
 *
 *       403:
 *         description: Forbidden
 */

/**
 * @openapi
 * /api/bills/me:
 *   get:
 *     tags:
 *       - Bills
 *     summary: Get logged-in user's bills
 *     description: Returns all bills belonging to the authenticated user.
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Bills found successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Bill'
 */

/**
 * @openapi
 * /api/bill/{id}:
 *   get:
 *     tags:
 *       - Bills
 *     summary: Get bill by ID
 *     description: Returns a single bill owned by the authenticated user.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Bill ID
 *
 *     responses:
 *       200:
 *         description: Bill found successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/Bill'
 *
 *       403:
 *         description: Forbidden
 *
 *       404:
 *         description: Bill not found
 *
 *   delete:
 *     tags:
 *       - Bills
 *     summary: Delete bill
 *     description: Deletes a bill owned by the authenticated user.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Bill ID
 *
 *     responses:
 *       200:
 *         description: Bill deleted successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Bill deleted successfully
 *
 *       403:
 *         description: Forbidden
 *
 *       404:
 *         description: Bill not found
 */

/**
 * @openapi
 * tags:
 *   - name: Transactions
 *     description: Transaction Management APIs
 */

/**
 * @openapi
 * /api/transaction:
 *   post:
 *     tags:
 *       - Transactions
 *     summary: Create transaction
 *     description: Creates a new transaction for the authenticated user.
 *     security:
 *       - bearerAuth: []
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTransactionRequest'
 *
 *     responses:
 *       201:
 *         description: Transaction added successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Transaction added successfully
 *                 data:
 *                   $ref: '#/components/schemas/Transaction'
 *
 *       401:
 *         description: Unauthorized
 *
 *       500:
 *         description: Internal Server Error
 */

/**
 * @openapi
 * /api/transactions:
 *   get:
 *     tags:
 *       - Transactions
 *     summary: Get all transactions
 *     description: Returns every transaction. Admin only.
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Transactions fetched successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Transaction'
 *
 *       403:
 *         description: Forbidden
 */

/**
 * @openapi
 * /api/transactions/me:
 *   get:
 *     tags:
 *       - Transactions
 *     summary: Get logged-in user's transactions
 *     description: Returns all transactions belonging to the authenticated user.
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Transactions fetched successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Transaction'
 */

/**
 * @openapi
 * /api/transaction/{id}:
 *   get:
 *     tags:
 *       - Transactions
 *     summary: Get transaction by ID
 *     description: Returns a transaction owned by the authenticated user.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Transaction ID
 *
 *     responses:
 *       200:
 *         description: Transaction found successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/Transaction'
 *
 *       403:
 *         description: Forbidden
 *
 *       404:
 *         description: Transaction not found
 *
 *   delete:
 *     tags:
 *       - Transactions
 *     summary: Delete transaction
 *     description: Deletes a transaction owned by the authenticated user.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Transaction ID
 *
 *     responses:
 *       200:
 *         description: Transaction deleted successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Transaction deleted successfully
 *
 *       403:
 *         description: Forbidden
 *
 *       404:
 *         description: Transaction not found
 */

/**
 * @openapi
 * tags:
 *   - name: Reports
 *     description: Financial Report APIs
 */

/**
 * @openapi
 * /api/reports/me:
 *   get:
 *     tags:
 *       - Reports
 *     summary: Generate financial report
 *     description: Generates and downloads a PDF financial report for the authenticated user.
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: PDF generated successfully.
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *
 *       401:
 *         description: Unauthorized
 *
 *       500:
 *         description: Internal Server Error
 */
