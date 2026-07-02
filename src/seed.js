const { db } = require('./config/database');
const { v4: uuidv4 } = require('uuid');

const products = [
  { barcode: '5901234123457', name: 'Whole Milk 1L', price: 3.50, cost: 2.80, stock: 50, category: 'Dairy' },
  { barcode: '5901234123464', name: 'White Bread', price: 2.00, cost: 1.20, stock: 30, category: 'Bakery' },
  { barcode: '5901234123471', name: 'Eggs (12 pack)', price: 5.00, cost: 3.50, stock: 40, category: 'Dairy' },
  { barcode: '5901234123488', name: 'Bananas 1kg', price: 2.50, cost: 1.80, stock: 25, category: 'Fruits' },
  { barcode: '5901234123495', name: 'Chicken Breast 500g', price: 7.00, cost: 5.00, stock: 20, category: 'Meat' },
  { barcode: '5901234123501', name: 'Rice 1kg', price: 4.00, cost: 2.80, stock: 35, category: 'Grains' },
  { barcode: '5901234123518', name: 'Pasta 500g', price: 2.50, cost: 1.50, stock: 45, category: 'Grains' },
  { barcode: '5901234123525', name: 'Tomato Sauce', price: 3.00, cost: 2.00, stock: 30, category: 'Condiments' },
  { barcode: '5901234123532', name: 'Orange Juice 1L', price: 4.50, cost: 3.20, stock: 25, category: 'Beverages' },
  { barcode: '5901234123549', name: 'Butter 250g', price: 4.00, cost: 3.00, stock: 20, category: 'Dairy' },
];

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO products (id, barcode, name, price, cost, stock, category)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const seedDb = db.transaction(() => {
  for (const product of products) {
    insertStmt.run(
      uuidv4(), product.barcode, product.name, product.price,
      product.cost, product.stock, product.category
    );
  }
});

seedDb();
console.log('10 products added!');
process.exit(0);