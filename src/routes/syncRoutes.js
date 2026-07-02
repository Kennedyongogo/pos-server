const express = require('express');
const ctrl = require('../controllers/syncController');

const router = express.Router();

router.get('/status', ctrl.status);
router.post('/flush', ctrl.flush);
router.post('/push', ctrl.push);
router.post('/bootstrap', ctrl.bootstrap);
router.post('/bootstrap-local', ctrl.bootstrapLocal);
router.get('/products', ctrl.products);

module.exports = router;
