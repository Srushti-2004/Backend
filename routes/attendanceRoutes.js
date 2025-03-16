const express = require('express');
const router = express.Router();
const { auth, isFaculty, isStudent } = require('../middleware/auth');
const Attendance = require('../models/Attendance');
const {
  generateSessionQR,
  markAttendance,
  getAttendanceReport,
  getStudentAttendance,
  getSessionDetails,
  exportSessionToExcel
} = require('../controllers/attendanceController');

// Faculty routes
router.post('/generate-qr', auth, isFaculty, generateSessionQR);
router.get('/report', auth, isFaculty, getAttendanceReport);
router.get('/session/:sessionId', auth, isFaculty, getSessionDetails);
router.get('/export/:sessionId', auth, isFaculty, exportSessionToExcel);

// Student routes
router.post('/mark', auth, isStudent, markAttendance);
router.get('/my-attendance', auth, isStudent, getStudentAttendance);

// Common routes (protected)

module.exports = router;