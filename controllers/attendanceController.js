const crypto = require("crypto");
const Attendance = require("../models/Attendance");
const User = require("../models/User");
const ExcelJS = require("exceljs");

// Generate QR code data for a session
const generateSessionQR = async (req, res) => {
  try {
    const { subject, classRoom } = req.body;
    const faculty = req.user ? req.user._id : null;

    // Validate required fields
    if (!faculty) {
      return res
        .status(401)
        .json({ message: "Unauthorized: Faculty ID missing" });
    }
    if (!subject || !classRoom) {
      return res
        .status(400)
        .json({ message: "Subject and Classroom are required" });
    }

    // Generate unique QR code
    let qrData;
    try {
      qrData = crypto.randomBytes(32).toString("hex");
    } catch (err) {
      // Error handled by returning error response
      return res.status(500).json({ message: "Error generating QR code" });
    }

    const sessionDate = new Date();

    // Create new attendance session
    const attendanceSession = new Attendance({
      faculty,
      subject,
      sessionDate,
      qrCode: qrData,
      classRoom,
      markedStudents: [],
      status: 'active'
    });

    await attendanceSession.save();

    // Set up automatic expiration after 2 minutes
    setTimeout(async () => {
      try {
        const session = await Attendance.findById(attendanceSession._id);
        if (session && session.status === 'active') {
          session.status = 'expired';
          await session.save();
          // Session expired automatically
        }
      } catch (error) {
        // Error expiring session handled silently
      }
    }, 2 * 60 * 1000); // 2 minutes

    res.json({
      message: "Session QR code generated successfully",
      qrCode: qrData,
      sessionId: attendanceSession._id,
      expiresIn: "2 minutes",
    });
  } catch (error) {
    // Error handled by returning error response
    res
      .status(500)
      .json({ message: "Error generating QR code", error: error.message });
  }
};

// Mark attendance using QR code
const markAttendance = async (req, res) => {
  try {
    const { qrCode } = req.body;
    const student = req.user._id;

    // Check for QR code validity within 2 minutes and active status
    const session = await Attendance.findOne({
      qrCode,
      sessionDate: { $gte: new Date(Date.now() - 2 * 60 * 1000) }, // 2 minutes expiration
      status: 'active'
    });

    if (!session) {
      return res.status(400).json({ message: "Invalid or expired QR code" });
    }

    if (session.markedStudents.includes(student.toString())) {
      return res
        .status(400)
        .json({ message: "Attendance already marked for this session" });
    }

    session.markedStudents.push(student);
    await session.save();

    res.json({ message: "Attendance marked successfully" });
  } catch (error) {
    // Error handled by returning error response
    res
      .status(500)
      .json({ message: "Error marking attendance", error: error.message });
  }
};

// Get attendance report for faculty
const getAttendanceReport = async (req, res) => {
  try {
    const { subject, startDate, endDate } = req.body;
    const faculty = req.user._id;

    const query = {
      faculty,
      ...(subject && { subject }),
      ...(startDate &&
        endDate && {
          sessionDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
        }),
    };

    const attendanceRecords = await Attendance.find(query)
      .populate("markedStudents", "name email")
      .sort({ sessionDate: -1 });

    const report = new Map();

    attendanceRecords.forEach((record) => {
      if (!report.has(record.subject)) {
        report.set(record.subject, { totalSessions: new Set(), students: {} });
      }

      const subjectData = report.get(record.subject);
      subjectData.totalSessions.add(
        record.sessionDate.toISOString().split("T")[0]
      );

      record.markedStudents.forEach((student) => {
        if (!subjectData.students[student._id]) {
          subjectData.students[student._id] = {
            name: student.name,
            email: student.email,
            attendanceCount: 0,
          };
        }
        subjectData.students[student._id].attendanceCount++;
      });
    });

    const formattedReport = {};
    report.forEach((data, subject) => {
      const totalSessions = data.totalSessions.size;
      const students = Object.values(data.students).map((s) => ({
        ...s,
        attendancePercentage: Number(((s.attendanceCount / totalSessions) * 100).toFixed(2))
      }));

      formattedReport[subject] = { totalSessions, students };
    });

    res.json(formattedReport);
  } catch (error) {
    // Error handled by returning error response
    res
      .status(500)
      .json({ message: "Error generating report", error: error.message });
  }
};

// Get student's own attendance
const getStudentAttendance = async (req, res) => {
  try {
    const student = req.user._id;
    const { subject } = req.query;

    const query = { markedStudents: student, ...(subject && { subject }) };

    const attendanceRecords = await Attendance.find(query)
      .populate("faculty", "name")
      .sort({ sessionDate: -1 });

    const report = {};
    attendanceRecords.forEach((record) => {
      if (!report[record.subject]) {
        report[record.subject] = { totalClasses: 0, attended: 0 };
      }

      report[record.subject].totalClasses++;
      report[record.subject].attended++;

      report[record.subject].attendancePercentage = Number(
        ((report[record.subject].attended / report[record.subject].totalClasses) * 100).toFixed(2)
      );
    });

    res.json(report);
  } catch (error) {
    // Error handled by returning error response
    res
      .status(500)
      .json({ message: "Error fetching attendance", error: error.message });
  }
};

// Get session details with student list
const getSessionDetails = async (req, res) => {
  try {
    // Extract parameters
    const { sessionId } = req.params;
    const faculty = req.user ? req.user._id : null;

    // Fetching session details

    // Basic validation
    if (!sessionId) {
      // Missing sessionId parameter
      return res.status(400).json({ message: "Session ID is required" });
    }

    if (!faculty) {
      // Missing faculty ID
      return res.status(401).json({ message: "Unauthorized: Faculty ID missing" });
    }

    // Try to convert sessionId to ObjectId to validate format
    let isValidId = false;
    try {
      // Simple length check instead of regex
      isValidId = sessionId.length === 24;
    } catch (err) {
      // Invalid sessionId format
    }

    if (!isValidId) {
      // Invalid sessionId format
      return res.status(400).json({ message: "Invalid session ID format" });
    }

    // First check if the session exists without faculty filter
    let sessionExists = false;
    try {
      sessionExists = await Attendance.exists({ _id: sessionId });
    } catch (err) {
      // Error checking if session exists
      return res.status(500).json({ message: "Error checking session existence" });
    }

    if (!sessionExists) {
      // Session not found
      return res.status(404).json({ message: "Session not found" });
    }

    // Then check if it belongs to the faculty
    let session = null;
    try {
      session = await Attendance.findOne({
        _id: sessionId,
        faculty
      }).populate("markedStudents", "name email");
    } catch (err) {
      // Error finding session
      return res.status(500).json({ message: "Error finding session" });
    }

    if (!session) {
      // Session does not belong to faculty
      return res.status(403).json({ message: "You don't have access to this session" });
    }

    // Session found

    // Safely extract student data
    let students = [];
    try {
      students = session.markedStudents.map(student => ({
        id: student._id,
        name: student.name || 'Unknown',
        email: student.email || 'No email'
      }));
    } catch (err) {
      // Error mapping student data
      // Continue with empty students array rather than failing
      students = [];
    }

    // Return session details even if expired
    const responseData = {
      sessionId: session._id,
      subject: session.subject || 'Unknown',
      classRoom: session.classRoom || 'Unknown',
      sessionDate: session.sessionDate || new Date(),
      status: session.status || 'unknown',
      students
    };

    // Returning session details
    return res.json(responseData);
  } catch (error) {
    // Error handled by returning error response
    return res
      .status(500)
      .json({ message: "Error fetching session details", error: error.message });
  }
};

// Export session attendance to Excel
const exportSessionToExcel = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const faculty = req.user._id;

    // Exporting Excel for session

    const session = await Attendance.findOne({
      _id: sessionId,
      faculty
    }).populate("markedStudents", "name email");

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    // Found session with students

    // Create a new Excel workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Attendance');

    // Add headers
    worksheet.columns = [
      { header: 'Student Name', key: 'name', width: 30 },
      { header: 'Email', key: 'email', width: 40 },
      { header: 'Attendance Status', key: 'status', width: 20 }
    ];

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD3D3D3' }
    };

    // Add session information
    worksheet.addRow([]);
    worksheet.addRow(['Subject', session.subject]);
    worksheet.addRow(['Classroom', session.classRoom]);
    worksheet.addRow(['Date', session.sessionDate.toLocaleDateString()]);
    worksheet.addRow(['Time', session.sessionDate.toLocaleTimeString()]);
    worksheet.addRow(['Status', session.status]);
    worksheet.addRow([]);

    // Add title for student list
    worksheet.addRow(['Student List']);
    worksheet.getRow(worksheet.rowCount).font = { bold: true };
    worksheet.addRow([]);

    // Add student data
    session.markedStudents.forEach(student => {
      worksheet.addRow({
        name: student.name,
        email: student.email,
        status: 'Present'
      });
    });

    // Excel workbook created

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_${session.subject}_${new Date().toISOString().split('T')[0]}.xlsx`);

    // Write to response
    await workbook.xlsx.write(res);
    res.end();
    // Excel file sent successfully
  } catch (error) {
    // Error handled by returning error response
    res
      .status(500)
      .json({ message: "Error exporting to Excel", error: error.message });
  }
};

module.exports = {
  generateSessionQR,
  markAttendance,
  getAttendanceReport,
  getStudentAttendance,
  getSessionDetails,
  exportSessionToExcel
};