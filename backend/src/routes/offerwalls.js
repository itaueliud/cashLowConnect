const express = require('express');
const router = express.Router();
const { getAyetStudiosWall, getAdGateWall, ayetStudiosCallback, adGateCallback, launchOfferwall, getOfferwallHistory } = require('../controllers/offerwallController');
const { protect, requireActivation, requireTestUserModuleAccess } = require('../middleware/auth');

router.get('/ayetstudios', protect, requireActivation, requireTestUserModuleAccess('Offerwalls'), getAyetStudiosWall);
router.get('/adgate', protect, requireActivation, requireTestUserModuleAccess('Offerwalls'), getAdGateWall);
router.get('/launch/:providerKey', protect, requireActivation, requireTestUserModuleAccess('Offerwalls'), launchOfferwall);
router.get('/history', protect, requireActivation, requireTestUserModuleAccess('Offerwalls'), getOfferwallHistory);
router.get('/ayetstudios/callback', ayetStudiosCallback);
router.get('/adgate/callback', adGateCallback);

module.exports = router;
