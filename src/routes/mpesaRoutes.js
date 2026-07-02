const express = require('express');
const ctrl = require('../controllers/mpesaController');

const router = express.Router();

router.get('/config', ctrl.getConfig);
router.get('/test-auth', ctrl.testAuth);
router.post('/stk-push', ctrl.stkPush);
router.post('/callback', ctrl.callback);
router.get('/status/:checkoutRequestId', ctrl.getStatus);

module.exports = router;
