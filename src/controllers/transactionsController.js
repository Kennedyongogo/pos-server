const transactionService = require('../services/transactionService');
const printerService = require('../services/printerService');
const { db } = require('../config/database');

exports.create = (req, res) => {
  try {
    const receiptData = transactionService.createTransaction(req.body);
    res.status(201).json({ success: true, data: receiptData });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.print = async (req, res) => {
  try {
    const transaction = transactionService.getTransactionById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }

    const client = db.prepare('SELECT business_name FROM clients WHERE id = ?').get(transaction.client_id);

    const receiptData = {
      ...transaction,
      receipt_number: 'POS-' + transaction.id.substring(0, 8),
      business_name: client ? client.business_name : 'POS System'
    };

    const printer = printerService.getPrinter();
    await printerService.printReceipt(printer, receiptData);
    res.json({ success: true, message: 'Receipt printed' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Print failed: ' + error.message });
  }
};

exports.listToday = (req, res) => {
  try {
    const { client_id } = req.query;
    const transactions = transactionService.listTodayTransactions(client_id);
    res.json({ success: true, data: transactions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.listAll = (req, res) => {
  try {
    const { client_id } = req.query;
    const transactions = transactionService.listAllTransactions(client_id);
    res.json({ success: true, data: transactions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getById = (req, res) => {
  try {
    const transaction = transactionService.getTransactionById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }
    res.json({ success: true, data: transaction });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.dailySummary = (req, res) => {
  try {
    const { client_id } = req.query;
    const summary = transactionService.getDailySummary(client_id);
    res.json({ success: true, data: summary });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
