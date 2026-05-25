const express = require('express');
const router = express.Router();
const { getCPXSurveyWall, getBitLabsWall, cpxCallback, bitlabsCallback, getSurveyFeed, getSurveyHistory, launchSurvey } = require('../controllers/surveyController');
const { protect, requireActivation, requireTestUserModuleAccess } = require('../middleware/auth');

router.get('/feed', protect, requireActivation, requireTestUserModuleAccess('Paid Surveys'), getSurveyFeed);
router.get('/launch/:providerKey/:surveyId?', protect, requireActivation, requireTestUserModuleAccess('Paid Surveys'), launchSurvey);
router.get('/cpx', protect, requireActivation, requireTestUserModuleAccess('Paid Surveys'), getCPXSurveyWall);
router.get('/bitlabs', protect, requireActivation, requireTestUserModuleAccess('Paid Surveys'), getBitLabsWall);
router.get('/cpx/callback', cpxCallback);
router.post('/bitlabs/callback', bitlabsCallback);
router.get('/history', protect, requireTestUserModuleAccess('Paid Surveys'), getSurveyHistory);

module.exports = router;
