#!/usr/bin/env node

/**
 * Journal Entry Discrepancy Analysis
 * Compares CSV journal entries against Shopify orders data
 */

const csvData = `Date,Reference,Account,Amount,Memo
01/29/2026,SO-#81376,1051.000,85.91,Cash/Check - Order #81376
01/29/2026,SO-#81376,3000.000,-80.05,Sales - Order #81376
01/29/2026,SO-#81376,2110.000,-5.86,Sales Tax - Order #81376
01/29/2026,SO-#81375,1061.000,89.29,Credit Card/PayPal - Order #81375
01/29/2026,SO-#81375,3000.000,-83.25,Sales - Order #81375
01/29/2026,SO-#81375,2110.000,-6.04,Sales Tax - Order #81375
01/29/2026,SO-#81373,1061.000,135.82,Credit Card/PayPal - Order #81373
01/29/2026,SO-#81373,3000.000,-126.60,Sales - Order #81373
01/29/2026,SO-#81373,2110.000,-9.22,Sales Tax - Order #81373
01/29/2026,SO-#81370,1061.000,111.01,Credit Card/PayPal - Order #81370
01/29/2026,SO-#81370,3000.000,-147.75,Sales - Order #81370
01/29/2026,SO-#81370,3034.000,44.25,Discount - Order #81370
01/29/2026,SO-#81370,2110.000,-7.51,Sales Tax - Order #81370
01/29/2026,SO-#81369,1061.000,976.50,Credit Card/PayPal - Order #81369
01/29/2026,SO-#81369,3000.000,-1395.00,Sales - Order #81369
01/29/2026,SO-#81369,3034.000,418.50,Discount - Order #81369
01/29/2026,SO-#81368,1061.000,74.83,Credit Card/PayPal - Order #81368
01/29/2026,SO-#81368,3000.000,-74.83,Sales - Order #81368
01/29/2026,SO-#81367,1051.000,13.89,Cash/Check - Order #81367
01/29/2026,SO-#81367,3000.000,-12.95,Sales - Order #81367
01/29/2026,SO-#81367,2110.000,-0.94,Sales Tax - Order #81367
01/29/2026,SO-#81366,1051.000,16.96,Cash/Check - Order #81366
01/29/2026,SO-#81366,3000.000,-15.80,Sales - Order #81366
01/29/2026,SO-#81366,2110.000,-1.16,Sales Tax - Order #81366
01/29/2026,SO-#81365,1061.000,245.95,Credit Card/PayPal - Order #81365
01/29/2026,SO-#81365,3000.000,-229.35,Sales - Order #81365
01/29/2026,SO-#81365,2110.000,-16.60,Sales Tax - Order #81365
01/29/2026,SO-#81364,1061.000,22.36,Credit Card/PayPal - Order #81364
01/29/2026,SO-#81364,3000.000,-20.85,Sales - Order #81364
01/29/2026,SO-#81364,2110.000,-1.51,Sales Tax - Order #81364
01/29/2026,SO-#81363,1061.000,133.65,Credit Card/PayPal - Order #81363
01/29/2026,SO-#81363,3000.000,-138.45,Sales - Order #81363
01/29/2026,SO-#81363,3034.000,13.84,Discount - Order #81363
01/29/2026,SO-#81363,2110.000,-9.04,Sales Tax - Order #81363
01/29/2026,SO-#81362,1061.000,1653.65,Credit Card/PayPal - Order #81362
01/29/2026,SO-#81362,3000.000,-1813.95,Sales - Order #81362
01/29/2026,SO-#81362,3034.000,272.09,Discount - Order #81362
01/29/2026,SO-#81362,2110.000,-111.79,Sales Tax - Order #81362
01/29/2026,SO-#81361,1061.000,33.42,Credit Card/PayPal - Order #81361
01/29/2026,SO-#81361,3000.000,-36.65,Sales - Order #81361
01/29/2026,SO-#81361,3034.000,5.49,Discount - Order #81361
01/29/2026,SO-#81361,2110.000,-2.26,Sales Tax - Order #81361
01/29/2026,SO-#81360,1061.000,1541.86,Credit Card/PayPal - Order #81360
01/29/2026,SO-#81360,3000.000,0.00,Sales - Order #81360
01/29/2026,RF-#81360,3035.000,1541.86,Refund - Order #81360
01/29/2026,RF-#81360,1061.000,-1541.86,Refund Credit Card/PayPal - Order #81360
01/29/2026,SO-#81359,1061.000,16.22,Credit Card/PayPal - Order #81359
01/29/2026,SO-#81359,3000.000,-18.90,Sales - Order #81359
01/29/2026,SO-#81359,3034.000,3.78,Discount - Order #81359
01/29/2026,SO-#81359,2110.000,-1.10,Sales Tax - Order #81359
01/29/2026,SO-#81358,1061.000,19.14,Credit Card/PayPal - Order #81358
01/29/2026,SO-#81358,3000.000,-17.85,Sales - Order #81358
01/29/2026,SO-#81358,2110.000,-1.29,Sales Tax - Order #81358
01/29/2026,SO-#81357,1061.000,55.00,Credit Card/PayPal - Order #81357
01/29/2026,SO-#81357,3000.000,-55.00,Sales - Order #81357
01/29/2026,SO-#81356,1051.000,294.94,Cash/Check - Order #81356
01/29/2026,SO-#81356,3000.000,-275.00,Sales - Order #81356
01/29/2026,SO-#81356,2110.000,-19.94,Sales Tax - Order #81356
01/29/2026,SO-#81355,2320.000,28.39,Gift Cards/Gift Certificates - Order #81355
01/29/2026,SO-#81355,3000.000,-31.10,Sales - Order #81355
01/29/2026,SO-#81355,3034.000,4.64,Discount - Order #81355
01/29/2026,SO-#81355,2110.000,-1.93,Sales Tax - Order #81355
01/29/2026,SO-#81354,1051.000,18.07,Cash/Check - Order #81354
01/29/2026,SO-#81354,3000.000,-16.85,Sales - Order #81354
01/29/2026,SO-#81354,2110.000,-1.22,Sales Tax - Order #81354
01/29/2026,SO-#81352,1061.000,72.38,Credit Card/PayPal - Order #81352
01/29/2026,SO-#81352,3000.000,-74.45,Sales - Order #81352
01/29/2026,SO-#81352,3034.000,6.99,Discount - Order #81352
01/29/2026,SO-#81352,2110.000,-4.92,Sales Tax - Order #81352
01/29/2026,SO-#81351,1061.000,37.54,Credit Card/PayPal - Order #81351
01/29/2026,SO-#81351,3000.000,-35.00,Sales - Order #81351
01/29/2026,SO-#81351,2110.000,-2.54,Sales Tax - Order #81351
01/29/2026,SO-#81350,1061.000,29.00,Credit Card/PayPal - Order #81350
01/29/2026,SO-#81350,3000.000,-17.75,Sales - Order #81350
01/29/2026,RF-#81350,3035.000,11.25,Refund - Order #81350
01/29/2026,RF-#81350,1061.000,-11.25,Refund Credit Card/PayPal - Order #81350
01/29/2026,SO-#81349,1061.000,74.83,Credit Card/PayPal - Order #81349
01/29/2026,SO-#81349,3000.000,-74.83,Sales - Order #81349
01/29/2026,SO-#81346,4005.000,191.56,Inventory Adjustment/Memo Offset/Transfer Offset - Order #81346
01/29/2026,SO-#81346,3000.000,-315.55,Sales - Order #81346
01/29/2026,SO-#81346,3034.000,136.94,Discount - Order #81346
01/29/2026,SO-#81346,2110.000,-12.95,Sales Tax - Order #81346
01/29/2026,SO-#81345,1061.000,801.28,Credit Card/PayPal - Order #81345
01/29/2026,SO-#81345,3000.000,-833.90,Sales - Order #81345
01/29/2026,SO-#81345,3034.000,86.79,Discount - Order #81345
01/29/2026,SO-#81345,2110.000,-54.17,Sales Tax - Order #81345
01/29/2026,SO-#81344,1061.000,112.63,Credit Card/PayPal - Order #81344
01/29/2026,SO-#81344,3000.000,-127.40,Sales - Order #81344
01/29/2026,SO-#81344,3034.000,23.84,Discount - Order #81344
01/29/2026,SO-#81344,2110.000,-9.07,Sales Tax - Order #81344
01/29/2026,SO-#81343,1061.000,20.23,Credit Card/PayPal - Order #81343
01/29/2026,SO-#81343,3000.000,-18.85,Sales - Order #81343
01/29/2026,SO-#81343,2110.000,-1.38,Sales Tax - Order #81343
01/29/2026,SO-#81341,2340.000,37.16,Store Credit/Store Credit Adjustments - Order #81341
01/29/2026,SO-#81341,3000.000,-38.45,Sales - Order #81341
01/29/2026,SO-#81341,3034.000,3.82,Discount - Order #81341
01/29/2026,SO-#81341,2110.000,-2.53,Sales Tax - Order #81341
01/29/2026,SO-#81340,1061.000,35.14,Credit Card/PayPal - Order #81340
01/29/2026,SO-#81340,3000.000,-32.75,Sales - Order #81340
01/29/2026,SO-#81340,2110.000,-2.39,Sales Tax - Order #81340
01/29/2026,SO-#81339,1061.000,21.44,Credit Card/PayPal - Order #81339
01/29/2026,SO-#81339,3000.000,-19.99,Sales - Order #81339
01/29/2026,SO-#81339,2110.000,-1.45,Sales Tax - Order #81339
01/29/2026,SO-#81338,1061.000,46.07,Credit Card/PayPal - Order #81338
01/29/2026,SO-#81338,3000.000,-42.95,Sales - Order #81338
01/29/2026,SO-#81338,2110.000,-3.12,Sales Tax - Order #81338
01/29/2026,SO-#81337,1061.000,184.43,Credit Card/PayPal - Order #81337
01/29/2026,SO-#81337,3000.000,-184.43,Sales - Order #81337
01/29/2026,SO-#81336,1061.000,500.00,Credit Card/PayPal - Order #81336
01/29/2026,SO-#81336,3000.000,-500.00,Sales - Order #81336
01/29/2026,SO-#81335,1061.000,4.50,Credit Card/PayPal - Order #81335
01/29/2026,SO-#81335,3000.000,-6.00,Sales - Order #81335
01/29/2026,SO-#81335,3034.000,1.80,Discount - Order #81335
01/29/2026,SO-#81335,2110.000,-0.30,Sales Tax - Order #81335
01/29/2026,SO-#81333,1061.000,10.29,Credit Card/PayPal - Order #81333
01/29/2026,SO-#81333,3000.000,-10.29,Sales - Order #81333
01/29/2026,SO-#81331,1061.000,68.12,Credit Card/PayPal - Order #81331
01/29/2026,SO-#81331,3000.000,-90.60,Sales - Order #81331
01/29/2026,SO-#81331,3034.000,27.09,Discount - Order #81331
01/29/2026,SO-#81331,2110.000,-4.61,Sales Tax - Order #81331
01/29/2026,SO-#81330,1061.000,5.36,Credit Card/PayPal - Order #81330
01/29/2026,SO-#81330,3000.000,-5.00,Sales - Order #81330
01/29/2026,SO-#81330,2110.000,-0.36,Sales Tax - Order #81330
01/29/2026,SO-#81329,1061.000,45.42,Credit Card/PayPal - Order #81329
01/29/2026,SO-#81329,3000.000,-43.04,Sales - Order #81329
01/29/2026,SO-#81329,2110.000,-2.38,Sales Tax - Order #81329
01/29/2026,SO-#81328,1061.000,31.48,Credit Card/PayPal - Order #81328
01/29/2026,SO-#81328,3000.000,-30.04,Sales - Order #81328
01/29/2026,SO-#81328,2110.000,-1.44,Sales Tax - Order #81328
01/29/2026,SO-#81327,1061.000,18.61,Credit Card/PayPal - Order #81327
01/29/2026,SO-#81327,3000.000,-17.35,Sales - Order #81327
01/29/2026,SO-#81327,2110.000,-1.26,Sales Tax - Order #81327
01/29/2026,SO-#81326,1061.000,37.12,Credit Card/PayPal - Order #81326
01/29/2026,SO-#81326,3000.000,-34.60,Sales - Order #81326
01/29/2026,SO-#81326,2110.000,-2.52,Sales Tax - Order #81326
01/29/2026,SO-#81325,1051.000,25.22,Cash/Check - Order #81325
01/29/2026,SO-#81325,3000.000,-33.50,Sales - Order #81325
01/29/2026,SO-#81325,3034.000,9.99,Discount - Order #81325
01/29/2026,SO-#81325,2110.000,-1.71,Sales Tax - Order #81325
01/29/2026,SO-#81324,1061.000,35.87,Credit Card/PayPal - Order #81324
01/29/2026,SO-#81324,3000.000,-39.35,Sales - Order #81324
01/29/2026,SO-#81324,3034.000,5.89,Discount - Order #81324
01/29/2026,SO-#81324,2110.000,-2.41,Sales Tax - Order #81324
01/29/2026,SO-#81271,1061.000,94.50,Credit Card/PayPal - Order #81271
01/29/2026,SO-#81271,3000.000,-94.50,Sales - Order #81271
01/29/2026,SO-#81268,1061.000,56.40,Credit Card/PayPal - Order #81268
01/29/2026,SO-#81268,3000.000,-49.90,Sales - Order #81268
01/29/2026,SO-#81268,3040.000,-6.50,Shipping - Order #81268
01/29/2026,SO-#81261,1061.000,25.36,Credit Card/PayPal - Order #81261
01/29/2026,SO-#81261,3000.000,-17.50,Sales - Order #81261
01/29/2026,SO-#81261,2110.000,-1.36,Sales Tax - Order #81261
01/29/2026,SO-#81261,3040.000,-6.50,Shipping - Order #81261
01/29/2026,SO-#81259,1061.000,119.00,Credit Card/PayPal - Order #81259
01/29/2026,SO-#81259,3000.000,-139.99,Sales - Order #81259
01/29/2026,SO-#81259,3034.000,20.99,Discount - Order #81259
01/29/2026,SO-#81251,1061.000,144.90,Credit Card/PayPal - Order #81251
01/29/2026,SO-#81251,3000.000,-144.00,Sales - Order #81251
01/29/2026,SO-#81251,3034.000,12.00,Discount - Order #81251
01/29/2026,SO-#81251,2110.000,-12.90,Sales Tax - Order #81251
01/29/2026,SO-#81247,1061.000,102.75,Credit Card/PayPal - Order #81247
01/29/2026,SO-#81247,3000.000,-104.75,Sales - Order #81247
01/29/2026,SO-#81247,3034.000,2.00,Discount - Order #81247
01/29/2026,SO-#81077,1061.000,319.18,Credit Card/PayPal - Order #81077
01/29/2026,SO-#81077,3000.000,-375.50,Sales - Order #81077
01/29/2026,SO-#81077,3034.000,56.32,Discount - Order #81077
01/29/2026,SO-#80992,1061.000,25.78,Credit Card/PayPal - Order #80992
01/29/2026,SO-#80992,3000.000,-17.90,Sales - Order #80992
01/29/2026,SO-#80992,2110.000,-1.38,Sales Tax - Order #80992
01/29/2026,SO-#80992,3040.000,-6.50,Shipping - Order #80992
01/29/2026,SO-#80974,1061.000,459.98,Credit Card/PayPal - Order #80974
01/29/2026,SO-#80974,3000.000,-459.98,Sales - Order #80974
01/29/2026,SO-#80973,1061.000,11.90,Credit Card/PayPal - Order #80973
01/29/2026,SO-#80973,3000.000,-31.90,Sales - Order #80973
01/29/2026,SO-#80973,3034.000,20.00,Discount - Order #80973`;

const shopifyOrders = [
  {"order":"#81322","total":59.52,"tax":5.02,"shipping":0.00,"refund":null,"current_total":59.52,"cash":null,"charge":null,"gift_card":16.26,"store_credit":null,"check":null,"gateway":"gift_card","amount":16.26,"payment_status":"paid","note":"Only gift_card transaction visible; possible split payment. Current Total column shows 59.52 but gift card only 16.26"},
  {"order":"#81325","total":25.22,"tax":1.71,"shipping":0.00,"refund":null,"current_total":25.22,"cash":25.22,"charge":null,"gift_card":null,"store_credit":null,"check":null,"gateway":"cash","amount":25.22},
  {"order":"#81324","total":35.87,"tax":2.41,"shipping":0.00,"refund":null,"current_total":35.87,"cash":null,"charge":35.87,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":35.87},
  {"order":"#81326","total":37.12,"tax":2.52,"shipping":0.00,"refund":null,"current_total":37.12,"cash":null,"charge":37.12,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":37.12},
  {"order":"#80974","total":459.98,"tax":0.00,"shipping":0.00,"refund":null,"current_total":459.98,"cash":null,"charge":459.98,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":459.98},
  {"order":"#81327","total":18.61,"tax":1.26,"shipping":0.00,"refund":null,"current_total":18.61,"cash":null,"charge":18.61,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":18.61},
  {"order":"#81077","total":319.18,"tax":0.00,"shipping":0.00,"refund":null,"current_total":319.18,"cash":null,"charge":319.18,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":319.18},
  {"order":"#80992","total":25.78,"tax":1.38,"shipping":6.50,"refund":null,"current_total":25.78,"cash":null,"charge":25.78,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":25.78},
  {"order":"#80973","total":11.90,"tax":0.00,"shipping":0.00,"refund":null,"current_total":11.90,"cash":null,"charge":11.90,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":11.90},
  {"order":"#81328","total":31.48,"tax":1.44,"shipping":0.00,"refund":null,"current_total":31.48,"cash":null,"charge":31.48,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":31.48},
  {"order":"#81334","total":120.25,"tax":10.30,"shipping":0.00,"refund":null,"current_total":120.25,"cash":null,"charge":null,"gift_card":75.00,"store_credit":null,"check":null,"gateway":"gift_card","amount":75.00,"note":"Only gift_card transaction visible; possible split payment. Total is 120.25 but gift card only 75.00"},
  {"order":"#81329","total":45.42,"tax":2.38,"shipping":0.00,"refund":null,"current_total":45.42,"cash":null,"charge":45.42,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":45.42},
  {"order":"#81330","total":5.36,"tax":0.36,"shipping":0.00,"refund":null,"current_total":5.36,"cash":null,"charge":5.36,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":5.36},
  {"order":"#81331","total":68.12,"tax":4.61,"shipping":0.00,"refund":null,"current_total":68.12,"cash":null,"charge":68.12,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":68.12},
  {"order":"#81333","total":10.29,"tax":0.00,"shipping":0.00,"refund":null,"current_total":10.29,"cash":null,"charge":10.29,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":10.29},
  {"order":"#81335","total":4.50,"tax":0.30,"shipping":0.00,"refund":null,"current_total":4.50,"cash":null,"charge":4.50,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":4.50},
  {"order":"#81336","total":500.00,"tax":0.00,"shipping":0.00,"refund":null,"current_total":500.00,"cash":null,"charge":500.00,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":500.00},
  {"order":"#81337","total":184.43,"tax":0.00,"shipping":0.00,"refund":null,"current_total":184.43,"cash":null,"charge":184.43,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":184.43},
  {"order":"#81338","total":46.07,"tax":3.12,"shipping":0.00,"refund":null,"current_total":46.07,"cash":null,"charge":46.07,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":46.07},
  {"order":"#81339","total":21.44,"tax":1.45,"shipping":0.00,"refund":null,"current_total":21.44,"cash":null,"charge":21.44,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":21.44},
  {"order":"#81341","total":37.16,"tax":2.53,"shipping":0.00,"refund":null,"current_total":37.16,"cash":null,"charge":null,"gift_card":null,"store_credit":37.16,"check":null,"gateway":"shopify_store_credit","amount":37.16},
  {"order":"#81340","total":35.14,"tax":2.39,"shipping":0.00,"refund":null,"current_total":35.14,"cash":null,"charge":35.14,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":35.14},
  {"order":"#81344","total":112.63,"tax":9.07,"shipping":0.00,"refund":null,"current_total":112.63,"cash":null,"charge":112.63,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":112.63},
  {"order":"#81343","total":20.23,"tax":1.38,"shipping":0.00,"refund":null,"current_total":20.23,"cash":null,"charge":20.23,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":20.23},
  {"order":"#81345","total":801.28,"tax":54.17,"shipping":0.00,"refund":null,"current_total":801.28,"cash":null,"charge":801.28,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":801.28},
  {"order":"#81251","total":144.90,"tax":12.90,"shipping":0.00,"refund":null,"current_total":144.90,"cash":null,"charge":144.90,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":144.90},
  {"order":"#81259","total":119.00,"tax":0.00,"shipping":0.00,"refund":null,"current_total":119.00,"cash":null,"charge":119.00,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":119.00},
  {"order":"#81261","total":25.36,"tax":1.36,"shipping":6.50,"refund":null,"current_total":25.36,"cash":null,"charge":25.36,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":25.36},
  {"order":"#81268","total":56.40,"tax":0.00,"shipping":6.50,"refund":null,"current_total":56.40,"cash":null,"charge":56.40,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":56.40},
  {"order":"#81271","total":94.50,"tax":0.00,"shipping":0.00,"refund":null,"current_total":94.50,"cash":null,"charge":94.50,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":94.50},
  {"order":"#81247","total":102.75,"tax":0.00,"shipping":0.00,"refund":null,"current_total":102.75,"cash":null,"charge":102.75,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":102.75},
  {"order":"#81195","total":7.33,"tax":0.65,"shipping":0.00,"refund":2.22,"current_total":7.33,"cash":null,"charge":null,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":-2.22,"kind":"refund","note":"This is a REFUND transaction only - original sale was on a different date. Refund of 2.22 on 01/29"},
  {"order":"#81346","total":191.56,"tax":12.95,"shipping":0.00,"refund":null,"current_total":191.56,"cash":null,"charge":191.56,"gift_card":null,"store_credit":null,"check":null,"gateway":"Charge","amount":191.56},
  {"order":"#81350","total":29.00,"tax":0.00,"shipping":0.00,"refund":11.25,"current_total":17.75,"cash":null,"charge":29.00,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","transactions":[{"kind":"sale","amount":29.00},{"kind":"refund","amount":-11.25}]},
  {"order":"#81349","total":74.83,"tax":0.00,"shipping":0.00,"refund":null,"current_total":74.83,"cash":null,"charge":74.83,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":74.83},
  {"order":"#81351","total":37.54,"tax":2.54,"shipping":0.00,"refund":null,"current_total":37.54,"cash":null,"charge":37.54,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":37.54},
  {"order":"#81352","total":72.38,"tax":4.92,"shipping":0.00,"refund":null,"current_total":72.38,"cash":null,"charge":72.38,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":72.38},
  {"order":"#81354","total":18.07,"tax":1.22,"shipping":0.00,"refund":null,"current_total":18.07,"cash":18.07,"charge":null,"gift_card":null,"store_credit":null,"check":null,"gateway":"cash","amount":18.07},
  {"order":"#81355","total":28.39,"tax":1.93,"shipping":0.00,"refund":null,"current_total":28.39,"cash":null,"charge":null,"gift_card":28.39,"store_credit":null,"check":null,"gateway":"gift_card","amount":28.39},
  {"order":"#81356","total":294.94,"tax":19.94,"shipping":0.00,"refund":null,"current_total":294.94,"cash":294.94,"charge":null,"gift_card":null,"store_credit":null,"check":null,"gateway":"cash","amount":294.94},
  {"order":"#81357","total":55.00,"tax":0.00,"shipping":0.00,"refund":null,"current_total":55.00,"cash":null,"charge":55.00,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":55.00},
  {"order":"#81360","total":1541.86,"tax":0.00,"shipping":0.00,"refund":1541.86,"current_total":0.00,"cash":null,"charge":null,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","transactions":[{"kind":"sale","amount":1541.86},{"kind":"refund","amount":-1541.86}],"payment_status":"refunded"},
  {"order":"#81362","total":1653.65,"tax":111.79,"shipping":0.00,"refund":null,"current_total":1653.65,"cash":null,"charge":1653.65,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":1653.65},
  {"order":"#81358","total":19.14,"tax":1.29,"shipping":0.00,"refund":null,"current_total":19.14,"cash":null,"charge":19.14,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":19.14},
  {"order":"#81359","total":16.22,"tax":1.10,"shipping":0.00,"refund":null,"current_total":16.22,"cash":null,"charge":16.22,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":16.22},
  {"order":"#81361","total":33.42,"tax":2.26,"shipping":0.00,"refund":null,"current_total":33.42,"cash":null,"charge":33.42,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":33.42},
  {"order":"#81363","total":133.65,"tax":9.04,"shipping":0.00,"refund":null,"current_total":133.65,"cash":null,"charge":133.65,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":133.65},
  {"order":"#81366","total":16.96,"tax":1.16,"shipping":0.00,"refund":null,"current_total":16.96,"cash":16.96,"charge":null,"gift_card":null,"store_credit":null,"check":null,"gateway":"cash","amount":16.96},
  {"order":"#81367","total":13.89,"tax":0.94,"shipping":0.00,"refund":null,"current_total":13.89,"cash":13.89,"charge":null,"gift_card":null,"store_credit":null,"check":null,"gateway":"cash","amount":13.89},
  {"order":"#81364","total":22.36,"tax":1.51,"shipping":0.00,"refund":null,"current_total":22.36,"cash":null,"charge":22.36,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":22.36},
  {"order":"#81369","total":976.50,"tax":0.00,"shipping":0.00,"refund":null,"current_total":976.50,"cash":null,"charge":976.50,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":976.50},
  {"order":"#81365","total":245.95,"tax":16.60,"shipping":0.00,"refund":null,"current_total":245.95,"cash":null,"charge":245.95,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":245.95},
  {"order":"#81368","total":74.83,"tax":0.00,"shipping":0.00,"refund":null,"current_total":74.83,"cash":null,"charge":74.83,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":74.83},
  {"order":"#81370","total":111.01,"tax":7.51,"shipping":0.00,"refund":null,"current_total":111.01,"cash":null,"charge":111.01,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":111.01},
  {"order":"#81376","total":85.91,"tax":5.86,"shipping":0.00,"refund":null,"current_total":85.91,"cash":85.91,"charge":null,"gift_card":null,"store_credit":null,"check":null,"gateway":"cash","amount":85.91},
  {"order":"#81373","total":135.82,"tax":9.22,"shipping":0.00,"refund":null,"current_total":135.82,"cash":null,"charge":135.82,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":135.82},
  {"order":"#81375","total":89.29,"tax":6.04,"shipping":0.00,"refund":null,"current_total":89.29,"cash":null,"charge":89.29,"gift_card":null,"store_credit":null,"check":null,"gateway":"shopify_payments","amount":89.29}
];

// Parse CSV
function parseCSV() {
  const lines = csvData.trim().split('\n');
  const entries = [];

  for (let i = 1; i < lines.length; i++) { // Skip header
    const match = lines[i].match(/^([^,]+),([^,]+),([^,]+),([^,]+),(.+)$/);
    if (match) {
      const [, date, reference, account, amount, memo] = match;
      entries.push({
        date,
        reference,
        account,
        amount: parseFloat(amount),
        memo
      });
    }
  }

  return entries;
}

// Calculate totals by account from CSV
function calculateCSVTotals(entries) {
  const totals = {};

  entries.forEach(entry => {
    if (!totals[entry.account]) {
      totals[entry.account] = 0;
    }
    totals[entry.account] += entry.amount;
  });

  return totals;
}

// Get orders from CSV
function getCSVOrders(entries) {
  const orders = new Set();
  entries.forEach(entry => {
    const match = entry.reference.match(/#(\d+)/);
    if (match) {
      orders.add(`#${match[1]}`);
    }
  });
  return Array.from(orders).sort();
}

// Calculate expected totals from Shopify
function calculateExpectedTotals(orders) {
  const totals = {
    cash: 0,
    card: 0,
    gift_card: 0,
    store_credit: 0,
    charge: 0,
    tax: 0,
    shipping: 0,
    refunds: 0
  };

  orders.forEach(order => {
    if (order.cash) totals.cash += order.cash;
    if (order.charge) totals.card += order.charge;
    if (order.gift_card) totals.gift_card += order.gift_card;
    if (order.store_credit) totals.store_credit += order.store_credit;
    if (order.gateway === 'Charge') totals.charge += order.amount;
    if (order.tax) totals.tax += order.tax;
    if (order.shipping) totals.shipping += order.shipping;
    if (order.refund) totals.refunds += order.refund;
    if (order.kind === 'refund') totals.refunds += Math.abs(order.amount);
  });

  return totals;
}

// Get Shopify orders
function getShopifyOrders(orders) {
  return orders.map(o => o.order).sort();
}

// Main analysis
function analyze() {
  console.log('=== JOURNAL ENTRY DISCREPANCY ANALYSIS ===\n');

  const csvEntries = parseCSV();
  const csvTotals = calculateCSVTotals(csvEntries);
  const csvOrders = getCSVOrders(csvEntries);
  const shopifyOrderList = getShopifyOrders(shopifyOrders);
  const expectedTotals = calculateExpectedTotals(shopifyOrders);

  // Print CSV totals by account
  console.log('CSV TOTALS BY ACCOUNT:');
  console.log('----------------------');
  Object.keys(csvTotals).sort().forEach(account => {
    console.log(`${account}: $${csvTotals[account].toFixed(2)}`);
  });

  console.log('\nEXPECTED TOTALS FROM SHOPIFY:');
  console.log('-----------------------------');
  console.log(`Cash (1051.000): $${expectedTotals.cash.toFixed(2)}`);
  console.log(`Card (1061.000): $${expectedTotals.card.toFixed(2)}`);
  console.log(`Gift Card (2320.000): $${expectedTotals.gift_card.toFixed(2)}`);
  console.log(`Store Credit (2340.000): $${expectedTotals.store_credit.toFixed(2)}`);
  console.log(`Charge/Manual (4005.000): $${expectedTotals.charge.toFixed(2)}`);
  console.log(`Tax (2110.000): -$${expectedTotals.tax.toFixed(2)}`);
  console.log(`Shipping (3040.000): -$${expectedTotals.shipping.toFixed(2)}`);
  console.log(`Refunds (3035.000): $${expectedTotals.refunds.toFixed(2)}`);

  console.log('\nACTUAL VS EXPECTED:');
  console.log('-------------------');
  console.log(`Cash (1051.000): Expected $${expectedTotals.cash.toFixed(2)}, Actual $${(csvTotals['1051.000'] || 0).toFixed(2)}, Diff: $${(expectedTotals.cash - (csvTotals['1051.000'] || 0)).toFixed(2)}`);
  console.log(`Card (1061.000): Expected $${expectedTotals.card.toFixed(2)}, Actual $${(csvTotals['1061.000'] || 0).toFixed(2)}, Diff: $${(expectedTotals.card - (csvTotals['1061.000'] || 0)).toFixed(2)}`);
  console.log(`Gift Card (2320.000): Expected $${expectedTotals.gift_card.toFixed(2)}, Actual $${(csvTotals['2320.000'] || 0).toFixed(2)}, Diff: $${(expectedTotals.gift_card - (csvTotals['2320.000'] || 0)).toFixed(2)}`);
  console.log(`Store Credit (2340.000): Expected $${expectedTotals.store_credit.toFixed(2)}, Actual $${(csvTotals['2340.000'] || 0).toFixed(2)}, Diff: $${(expectedTotals.store_credit - (csvTotals['2340.000'] || 0)).toFixed(2)}`);
  console.log(`Charge (4005.000): Expected $${expectedTotals.charge.toFixed(2)}, Actual $${(csvTotals['4005.000'] || 0).toFixed(2)}, Diff: $${(expectedTotals.charge - (csvTotals['4005.000'] || 0)).toFixed(2)}`);
  console.log(`Tax (2110.000): Expected -$${expectedTotals.tax.toFixed(2)}, Actual $${(csvTotals['2110.000'] || 0).toFixed(2)}, Diff: $${(-expectedTotals.tax - (csvTotals['2110.000'] || 0)).toFixed(2)}`);
  console.log(`Shipping (3040.000): Expected -$${expectedTotals.shipping.toFixed(2)}, Actual $${(csvTotals['3040.000'] || 0).toFixed(2)}, Diff: $${(-expectedTotals.shipping - (csvTotals['3040.000'] || 0)).toFixed(2)}`);
  console.log(`Refunds (3035.000): Expected $${expectedTotals.refunds.toFixed(2)}, Actual $${(csvTotals['3035.000'] || 0).toFixed(2)}, Diff: $${(expectedTotals.refunds - (csvTotals['3035.000'] || 0)).toFixed(2)}`);

  console.log('\nMISSING ORDERS (in Shopify but not in CSV):');
  console.log('-------------------------------------------');
  const missingOrders = shopifyOrderList.filter(order => !csvOrders.includes(order));
  if (missingOrders.length === 0) {
    console.log('None');
  } else {
    missingOrders.forEach(order => {
      const orderData = shopifyOrders.find(o => o.order === order);
      console.log(`${order}: Total $${orderData.total.toFixed(2)}, Gateway: ${orderData.gateway}, Amount: $${orderData.amount.toFixed(2)}`);
      if (orderData.note) {
        console.log(`  Note: ${orderData.note}`);
      }
    });
  }

  console.log('\nEXTRA ORDERS (in CSV but not in Shopify):');
  console.log('-----------------------------------------');
  const extraOrders = csvOrders.filter(order => !shopifyOrderList.includes(order));
  if (extraOrders.length === 0) {
    console.log('None');
  } else {
    extraOrders.forEach(order => console.log(order));
  }

  console.log('\nORDER COUNTS:');
  console.log('-------------');
  console.log(`Shopify orders: ${shopifyOrderList.length}`);
  console.log(`CSV orders: ${csvOrders.length}`);
  console.log(`Missing: ${missingOrders.length}`);
  console.log(`Extra: ${extraOrders.length}`);

  // Detailed analysis of missing orders
  console.log('\n=== DETAILED MISSING ORDER ANALYSIS ===\n');

  missingOrders.forEach(order => {
    const orderData = shopifyOrders.find(o => o.order === order);
    console.log(`\nOrder ${order}:`);
    console.log(`  Total: $${orderData.total.toFixed(2)}`);
    console.log(`  Tax: $${orderData.tax.toFixed(2)}`);
    console.log(`  Shipping: $${orderData.shipping.toFixed(2)}`);
    console.log(`  Gateway: ${orderData.gateway}`);
    console.log(`  Amount: $${orderData.amount.toFixed(2)}`);
    console.log(`  Payment Status: ${orderData.payment_status || 'N/A'}`);
    if (orderData.kind) {
      console.log(`  Kind: ${orderData.kind}`);
    }
    if (orderData.note) {
      console.log(`  NOTE: ${orderData.note}`);
    }

    // Analyze payment breakdown
    const payments = [];
    if (orderData.cash) payments.push(`Cash: $${orderData.cash.toFixed(2)}`);
    if (orderData.charge) payments.push(`Card: $${orderData.charge.toFixed(2)}`);
    if (orderData.gift_card) payments.push(`Gift Card: $${orderData.gift_card.toFixed(2)}`);
    if (orderData.store_credit) payments.push(`Store Credit: $${orderData.store_credit.toFixed(2)}`);

    if (payments.length > 0) {
      console.log(`  Payment Breakdown: ${payments.join(', ')}`);
    }

    // Check if this is a split payment
    const totalPayments = (orderData.cash || 0) + (orderData.charge || 0) +
                         (orderData.gift_card || 0) + (orderData.store_credit || 0);
    if (Math.abs(totalPayments - orderData.total) > 0.01) {
      console.log(`  ⚠️  SPLIT PAYMENT DETECTED: Visible payments ($${totalPayments.toFixed(2)}) != Total ($${orderData.total.toFixed(2)})`);
      console.log(`     Missing payment amount: $${(orderData.total - totalPayments).toFixed(2)}`);
    }
  });
}

analyze();
