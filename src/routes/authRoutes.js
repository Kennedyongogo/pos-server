const express = require('express');
const ctrl = require('../controllers/authController');

const router = express.Router();

router.post('/login', ctrl.login);
router.post('/clients', ctrl.createClient);
router.get('/clients', ctrl.listClients);
router.get('/client-credentials/:clientId', ctrl.getClientCredentials);
router.get('/users', ctrl.listUsers);
router.post('/users', ctrl.createUser);
router.put('/users/:id/password', ctrl.resetPassword);
router.delete('/users/:id', ctrl.deactivateUser);

module.exports = router;
