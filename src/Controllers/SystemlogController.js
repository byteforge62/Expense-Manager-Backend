const SystemLog = require("../models/SystemlogModel");

const getLogs = async (req, res) => {
  try {
    const logs = await SystemLog.find().sort({ createdAt: -1 }).lean();

    return res.status(200).json({
      success: true,
      message: "Logs fetched successfully",
      data: logs,
    });
  } catch (error) {
    console.error("Failed to fetch system logs:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to fetch logs",
    });
  }
};

module.exports = {
  getLogs,
};
