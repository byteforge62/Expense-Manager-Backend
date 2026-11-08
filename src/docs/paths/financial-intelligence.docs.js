/**
 * @openapi
 * /api/financial-intelligence/overview:
 *   get:
 *     summary: Generate the authenticated user's financial intelligence overview
 *     tags:
 *       - Financial Intelligence
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Inclusive UTC calendar start day; defaults to 89 days before the current UTC day.
 *       - in: query
 *         name: endDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Inclusive UTC calendar end day; defaults to the current UTC day. The inclusive period is limited to 366 days.
 *     responses:
 *       200:
 *         description: Consolidated financial metrics and analytical results.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, message, data]
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Financial intelligence generated successfully
 *                 data:
 *                   type: object
 *                   required: [generatedAt, dataConfidence, metrics, behavior, anomalies, anomalySummary, financialHealth, recommendations, rules, ruleSummary]
 *                   properties:
 *                     generatedAt:
 *                       type: string
 *                       format: date-time
 *                     dataConfidence:
 *                       type: object
 *                       properties:
 *                         level:
 *                           type: string
 *                           enum: [low, medium, high]
 *                         samples:
 *                           type: object
 *                         limitations:
 *                           type: array
 *                           items:
 *                             type: string
 *                     metrics:
 *                       type: object
 *                       description: Selected-period totals, daily series, categories, obligations, and comparison.
 *                     behavior:
 *                       type: object
 *                       description: Evidence-based observations, weekday patterns, and consistency measures.
 *                     anomalies:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           type:
 *                             type: string
 *                           amount:
 *                             type: number
 *                           baseline:
 *                             type: number
 *                           deviation:
 *                             type: number
 *                           deviationPercent:
 *                             type: number
 *                             nullable: true
 *                           method:
 *                             type: string
 *                           severity:
 *                             type: string
 *                             enum: [medium, high]
 *                           reason:
 *                             type: string
 *                     anomalySummary:
 *                       type: object
 *                     financialHealth:
 *                       type: object
 *                       properties:
 *                         score:
 *                           type: number
 *                           nullable: true
 *                         label:
 *                           type: string
 *                         scoringWeights:
 *                           type: object
 *                         components:
 *                           type: object
 *                         missingData:
 *                           type: array
 *                           items:
 *                             type: string
 *                     recommendations:
 *                       type: array
 *                       items:
 *                         type: object
 *                         required: [id, type, title, description, priority, evidence, method, estimatedFinancialImpact, confidenceLevel, nextStep]
 *                         properties:
 *                           id:
 *                             type: string
 *                           type:
 *                             type: string
 *                           title:
 *                             type: string
 *                           description:
 *                             type: string
 *                           priority:
 *                             type: string
 *                             enum: [critical, high, medium, low]
 *                           evidence:
 *                             type: object
 *                           method:
 *                             type: string
 *                           estimatedFinancialImpact:
 *                             type: object
 *                             nullable: true
 *                           confidenceLevel:
 *                             type: string
 *                             enum: [low, medium, high]
 *                           nextStep:
 *                             type: string
 *                     rules:
 *                       type: array
 *                       items:
 *                         type: object
 *                         required: [ruleId, type, condition, threshold, severity, priority, status, triggered, explanation, evidence]
 *                         properties:
 *                           ruleId:
 *                             type: string
 *                           type:
 *                             type: string
 *                           condition:
 *                             type: string
 *                           threshold:
 *                             type: object
 *                             nullable: true
 *                           severity:
 *                             type: string
 *                           priority:
 *                             type: number
 *                           status:
 *                             type: string
 *                             enum: [triggered, clear, not-evaluated]
 *                           triggered:
 *                             type: boolean
 *                           explanation:
 *                             type: string
 *                           evidence:
 *                             nullable: true
 *                     ruleSummary:
 *                       type: object
 *       400:
 *         description: Invalid query parameters or reversed date range.
 *       401:
 *         description: Authentication is required.
 */
