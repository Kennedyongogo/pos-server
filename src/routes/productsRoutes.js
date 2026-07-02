const express = require('express');
const ctrl = require('../controllers/productsController');

const router = express.Router();

router.get('/', ctrl.list);
router.get('/barcode/:barcode', ctrl.getByBarcode);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
