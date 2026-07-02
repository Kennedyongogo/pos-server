const express = require('express');
const ctrl = require('../controllers/mpesaController');

const router = express.Router();

router.get('/config', ctrl.getConfig);
router.get('/settings/:clientId', ctrl.getSettings);
router.put('/settings/:clientId', ctrl.saveSettings);
router.post('/test-auth', ctrl.testAuth);
router.post('/test-stk', ctrl.testStk);
router.post('/stk-push', ctrl.stkPush);
router.post('/callback', ctrl.callback);
router.get('/status/:checkoutRequestId', ctrl.getStatus);

module.exports = router;
