const express = require('express');
const router = express.Router();
const { protect, requireActivation, requireTestUserModuleAccess } = require('../middleware/auth');
const { getAdsNetworkProviders, launchAdsProvider, getAdsNetworkHistory } = require('../controllers/adsNetworkController');

router.get('/providers', protect, requireActivation, requireTestUserModuleAccess('Ads / Ad Network'), getAdsNetworkProviders);
router.get('/launch/:providerKey', protect, requireActivation, requireTestUserModuleAccess('Ads / Ad Network'), launchAdsProvider);
router.get('/history', protect, requireActivation, requireTestUserModuleAccess('Ads / Ad Network'), getAdsNetworkHistory);

module.exports = router;
