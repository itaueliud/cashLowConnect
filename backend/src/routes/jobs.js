const express = require('express');
const router = express.Router();
const { getJobs, getJob, getCategories, createJobPosting, syncJobs } = require('../controllers/jobController');
const { applyToJob } = require('../controllers/jobApplicationController');
const { protect, requireActivation, staffOnly } = require('../middleware/auth');

router.get('/', protect, getJobs);
router.post('/', protect, requireActivation, createJobPosting);
router.get('/categories', protect, getCategories);
router.post('/sync-now', protect, staffOnly, async (req, res) => {
  await syncJobs();
  res.json({ success: true, message: 'Job sync completed' });
});
router.get('/:id', protect, getJob);
router.post('/:id/apply', protect, applyToJob);

module.exports = router;
