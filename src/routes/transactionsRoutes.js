const express = require('express');
const ctrl = require('../controllers/transactionsController');

const router = express.Router();

router.post('/', ctrl.create);
router.post('/print/:id', ctrl.print);
router.get('/today', ctrl.listToday);
router.get('/all', ctrl.listAll);
router.get('/summary/daily', ctrl.dailySummary);
router.get('/:id', ctrl.getById);

module.exports = router;
