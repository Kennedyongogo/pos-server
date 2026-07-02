const escpos = require('escpos');
const escposUSB = require('escpos-usb');

// Auto-detect USB printer or use default
function getPrinter() {
  try {
    const devices = escposUSB.findPrinter();
    if (devices && devices.length > 0) {
      const device = devices[0];
      return new escpos.Printer(new escposUSB(device.deviceDescriptor.idVendor, device.deviceDescriptor.idProduct));
    }
    // Fallback: try default USB vendor/product for common thermal printers
    // Epson TM-T20: vendorId=0x04b8, productId=0x0202
    return new escpos.Printer(new escposUSB(0x04b8, 0x0202));
  } catch (err) {
    console.log('Printer not connected:', err.message);
    return null;
  }
}

function printReceipt(printer, data) {
  return new Promise((resolve, reject) => {
    if (!printer) {
      console.log('No printer available — skipping print');
      return resolve(false);
    }

    try {
      printer
        .align('ct')
        .style('bu')
        .size(1, 1)
        .text(data.business_name || 'POS System')
        .style('normal')
        .size(0, 0)
        .text('')
        .text('Receipt #: ' + data.receipt_number)
        .text('Date: ' + new Date(data.created_at).toLocaleString())
        .text('Cashier: ' + (data.cashier_name || 'N/A'))
        .text('')
        .align('lt')
        .text('----------------------------------------')
        .text('Item          Qty    Price    Subtotal')
        .text('----------------------------------------');
      
      if (data.items && data.items.length > 0) {
        data.items.forEach(item => {
          const name = item.product_name.substring(0, 14).padEnd(14);
          const qty = String(item.quantity).padStart(3);
          const price = '$' + parseFloat(item.unit_price).toFixed(2).padStart(7);
          const subtotal = '$' + parseFloat(item.subtotal).toFixed(2).padStart(8);
          printer.text(`${name} ${qty} ${price} ${subtotal}`);
        });
      }
      
      printer
        .text('----------------------------------------')
        .align('rt')
        .style('bu')
        .size(1, 1)
        .text('TOTAL: $' + parseFloat(data.total).toFixed(2))
        .style('normal')
        .size(0, 0)
        .text('')
        .align('ct')
        .text('Payment: ' + (data.payment_method || 'Cash'))
        .text('')
        .text('Thank you for your purchase!')
        .text('')
        .cut()
        .close(() => {
          console.log('Receipt printed successfully');
          resolve(true);
        });
    } catch (err) {
      console.log('Print error:', err.message);
      reject(err);
    }
  });
}

module.exports = { getPrinter, printReceipt };