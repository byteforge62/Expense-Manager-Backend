const PDFDocument = require("pdfkit");
const { asyncHandler } = require("../utiles/response");
const ReportService = require("../services/report.service");

const generateReport = asyncHandler(async (req, res) => {
  // Resolve and validate every record first. Once `doc.pipe(res)` runs the
  // response headers are committed, so a NotFoundError thrown afterwards could
  // only truncate the download instead of returning a JSON error.
  const data = await ReportService.collectReportData(req.user.id);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=financial-report.pdf"
  );

  const doc = new PDFDocument();

  doc.pipe(res);

  ReportService.writeReport(doc, data);

  doc.end();
});

module.exports = {
  generateReport,
};
