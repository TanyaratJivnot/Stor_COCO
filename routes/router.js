const express = require('express');
const axios = require('axios');
const moment = require('moment-timezone');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const Owner = require('../models/Owner.js');
const import_products = require('../models/import_Product.js');
const Employee = require('../models/Employee.js');
const Product = require('../models/Product.js');
const Count_product = require('../models/Counts_Product');
const ActivityLog = require('../models/ActivityLog');
const SalesOrder = require('../models/Sales_Order');
const getWeatherData = require('../models/weater');
const { body, validationResult } = require('express-validator');

const id_product = {
    'น้ำมะพร้าวแก้ว': { Product_ID: 1 }, 
    'มะพร้าวลูก': { Product_ID: 2 }, 
    'มะพร้าวขวด': { Product_ID: 3 }, 
    'พุดดิ้งมะพร้าว': { Product_ID: 4 }, 
    'เนื้อมะพร้าวครึ่งโล': { Product_ID: 6 }, 
    'น้ำนมข้าวโพด': { Product_ID: 10 }, 
    'ป๊อปคอร์นขนาดใหญ่': { Product_ID: 14 }, 
    'ป๊อปคอร์นขนาดกลาง': { Product_ID: 15 }, 
    'ป๊อปคอร์นขนาดเล็ก': { Product_ID: 16 }
};
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '../public/img'))  // ตำแหน่งเก็บไฟล์
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname)  // ตั้งชื่อไฟล์ใหม่เพื่อหลีกเลี่ยงชื่อซ้ำ
    }
});
const upload = multer({ storage: storage });

let employees_items;

let notificate_items = [];
async function createNotifications(req) {
    try {
        const loginActivities = await ActivityLog.find({
            Activity_Type: { $in: ['login', 'logout'] }
        }).exec();

        notificate_items.length = 0;

        for (const activity of loginActivities) {
            const employee = await Employee.findOne({ Employee_ID: activity.Employee_ID }).exec();
            if (employee) {
                const timeString = moment(activity.Activity_Timestamp)
                    .tz('Asia/Bangkok')
                    .format('HH:mm');
                let description = activity.Activity_Type === 'login' ? 'เข้างาน' : 'ออกงาน';

                notificate_items.push({
                    name: employee.Username,
                    img: employee.IMG,
                    des: description,
                    time: timeString
                });
            }
        }

        if (!req.session.mlNotified) {
            notificate_items.unshift({
                name: 'ML',
                img: '/img/logo_new.png',
                des: 'ผลการทำนายการสั่งซื้อล่วงหน้า',
                time: moment().tz('Asia/Bangkok').format('HH:mm')
            });
            req.session.mlNotified = true;
        }
    } catch (error) {
        console.error('Error creating notifications:', error);
    }
}


let notificate_count = notificate_items.length;


const categoryMappings = {
    'น้ำตาล': { Category_ID: 2, Type_ID: 1 },
    'ข้าวโพด': { Category_ID: 3, Type_ID: 1 },
    'วัตถุดิบ': { Category_ID: 7, Type_ID: 2 },
    'กล้วย': { Category_ID: 4, Type_ID: 1 },
    'ถั่ว': { Category_ID: 5, Type_ID: 1 },
    'ส้มโอ': { Category_ID: 6, Type_ID: 1 },
    'น้ำปั่น': { Category_ID: 8, Type_ID: 1 },
    'มะพร้าว': { Category_ID: 1, Type_ID: 1 }

};


router.get('/home', async (req, res) => {
    try {
        await createNotifications(req); 
        const weather = await getWeatherData();
        res.render('home.ejs', {
            employees_items,
            notificate_items,
            notificate_count: notificate_items.length,
            formattedDate: null,
            selectedDate: req.query.date,
            temperature: weather.temperature,
            weatherIcon: weather.icon  
        });
    } catch (error) {
        console.error('Error when rendering home:', error);
        res.status(500).send('Error loading the page');
    }
});

router.get('/totalSale', async(req, res) => {
    try {
        let selectedDate = req.query.date;
        console.log("Selected home date:", selectedDate);

        // Aggregate sales data for the selected date
        const salesData = await SalesOrder.aggregate([
            { $match: { Order_Date: selectedDate } },
            { $lookup: {
                from: "products",
                localField: "Product_ID",
                foreignField: "Product_ID",
                as: "productDetails"
            }},
            { $unwind: "$productDetails" },
            { $project: {
                totalPerProduct: { $multiply: ["$Total_Amount", "$productDetails.PricePrduct"] }
            }},
            { $group: {
                _id: null,
                salesTotalAmount: { $sum: "$totalPerProduct" }
            }}
        ]).exec();

        const totalSales = salesData.length > 0 ? salesData[0].salesTotalAmount : 0;
        console.log("Sales Total Amount:", totalSales);
        // Render the home page
        res.send(salesData);

    } catch (error) {
        console.error('Error when rendering home:', error);
        res.status(500).send('Error loading the page');
    }
});
  
router.get('/sales-data', async (req, res) => {
    try {
        let selectedDate = req.query.date;
        console.log(selectedDate);
        const salesData = await SalesOrder.aggregate([
            { $match: { Order_Date: selectedDate } }, // Match the orders by selected date
            {
                $lookup: {
                    from: 'products',
                    localField: 'Product_ID', // Field in SalesOrder
                    foreignField: 'Product_ID', // Field in Product
                    as: 'productDetails'
                }
            },
            {
                $unwind: '$productDetails'
            },
            {
                $project: {
                    _id: 0,
                    NameProduct: '$productDetails.NameProduct', // Assuming 'NameProduct' is the field for product name
                    Total_Amount: 1
                }
            }
        ]);
        res.send(salesData);
        console.log("salesData:", salesData);
    } catch (error) {
        console.error('Error fetching sales data:', error);
        res.status(500).send('Failed to fetch data');
    }
});
router.get('/sales-today', async (req, res) => {
    // ตั้งค่าวันที่ใหม่โดยไม่มีเวลาและแปลงเป็นรูปแบบ YYYY-MM-DD
    const now = new Date();
    const selectedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const formattedDate = selectedDate.toISOString().split('T')[0]; // YYYY-MM-DD

    console.log("Formatted selectedDate :", formattedDate); // Outputs date in YYYY-MM-DD format

    try {
        const salesData = await SalesOrder.aggregate([
            { $match: { Order_Date: formattedDate } },
            { $lookup: {
                from: "products",
                localField: "Product_ID",
                foreignField: "Product_ID",
                as: "productDetails"
            }},
            { $unwind: "$productDetails" },
            { $project: {
                totalPerProduct: { $multiply: ["$Total_Amount", "$productDetails.PricePrduct"] }
            }},
            { $group: {
                _id: null,
                salesTotalAmount: { $sum: "$totalPerProduct" }
            }}
        ]).exec();
        const totalSales = salesData.length > 0 ? salesData[0].salesTotalAmount : 0;
        console.log("Sales to day Amount:", totalSales);
        res.send(salesData);
    } catch (error) {
        console.error('Error fetching sales data:', error);
        res.status(500).send('Failed to fetch data');
    }
});
router.get('/productPopular', async (req, res) => {
    const now = new Date();
    const selectedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const formattedDate = selectedDate.toISOString().split('T')[0]; // YYYY-MM-DD

    console.log("Formatted selectedDate:", formattedDate); // Outputs date in YYYY-MM-DD format

    try {
        const productPopularData = await SalesOrder.aggregate([
            {
                $match: { Order_Date: formattedDate } // Ensure dates are compared correctly
            },
            {
                $group: {
                    _id: '$Product_ID', // Group by Product ID
                    totalSold: { $sum: '$Total_Amount' } // Sum total amount for each product
                }
            },
            {
                $sort: { totalSold: -1 } // Sort by totalSold in descending order
            },
            {
                $lookup: {
                    from: 'products', // Assuming your products collection is named 'products'
                    localField: '_id',
                    foreignField: 'Product_ID',
                    as: 'productDetails'
                }
            },
            {
                $unwind: {
                    path: '$productDetails',
                    preserveNullAndEmptyArrays: true // Preserve documents even if 'productDetails' is missing
                }
            },
            {
                $project: {
                    _id: 0,
                    NameProduct: '$productDetails.NameProduct', // Select the product name
                    totalSold: 1
                }
            },
            {
                $limit: 1 // Limit to the top 1 most sold product
            }
        ]);

        // Check if data is empty or null, and handle accordingly
        if (!productPopularData.length || !productPopularData[0].NameProduct) {
            res.send([{NameProduct: '--', totalSold: '--'}]);
        } else {
            res.send(productPopularData);
        }
    } catch (error) {
        console.error('Error fetching popular product data:', error);
        res.status(500).send('Failed to fetch data');
    }
});
router.get('/employeeSales', async (req, res) => {
   /*  const now = new Date();
    const selectedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    //const formattedDate = selectedDate.toISOString().split('T')[0];
    const formattedDate = "2023-02-08"; //test
    console.log("employeeSales selectedDate :", formattedDate); */
    try {
        let formattedDate = req.query.date;
        console.log("employeeSales selectedDate :", formattedDate);
        const salesData = await SalesOrder.aggregate([
            { $match: { Order_Date: formattedDate } },
            { $lookup: {
                from: 'products',
                localField: 'Product_ID',
                foreignField: 'Product_ID',
                as: 'productDetails'
            }},
            { $unwind: '$productDetails' },
            { $lookup: {
                from: 'employees',
                localField: 'Employee_ID',
                foreignField: 'Employee_ID',
                as: 'employeeDetails'
            }},
            { $unwind: '$employeeDetails' },
            { $group: {
                _id: '$Employee_ID',
                name: { $first: '$employeeDetails.Username' },
                quantity: { $sum: '$Total_Amount' },
                totalSales: { $sum: { $multiply: ['$Total_Amount', '$productDetails.PricePrduct'] } }
            }}
        ]);
        console.log("employeeSalesData:",salesData);
        res.send(salesData);
    } catch (error) {
        console.error('Error fetching employeeSales data:', error);
        res.status(500).send('Failed to fetch data');
    }
});
router.get('/remainingforDay', async (req, res) => {
    const now = new Date();
    const selectedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const formattedDate = selectedDate.toISOString().split('T')[0];
    console.log("Remaining selectedDate :", formattedDate);
    try {
        const remainingData = await Count_product.aggregate([
            {
                $match: { CountDate: formattedDate }
            },
            {
                $lookup: {
                    from: 'products',
                    localField: 'Product_ID',
                    foreignField: 'Product_ID',
                    as: 'productDetails'
                }
            },
            {
                $unwind: '$productDetails'
            },
            {
                $project: {
                    _id: 0,
                    productName: '$productDetails.NameProduct',
                    remainingQuantity: '$remaining', 
                    countSell: '$Count_sell', 
                    expireDate: '$expire'
                }
            }
        ]);
        console.log("Remaining data:", remainingData);
        res.send(remainingData);

    } catch (error) {
        console.error('Error fetching remaining products data:', error);
        res.status(500).send('Failed to fetch remaining products data');
    }
});

router.get('/productPopular5', async (req, res) => {
    try {
        let formattedDate = req.query.date;
        console.log("productPopular5 selectedDate :", formattedDate);
        const productPopularData = await SalesOrder.aggregate([
            {
                $match: {
                    Order_Date: formattedDate,
                    Total_Amount: { $gt: 1 } // Only include items with a quantity greater than 1
                }
            },
            {
                $lookup: {
                    from: 'products',
                    localField: 'Product_ID',
                    foreignField: 'Product_ID',
                    as: 'productDetails'
                }
            },
            {
                $unwind: '$productDetails'
            },
            {
                $group: {
                    _id: '$Product_ID',
                    productName: { $first: '$productDetails.NameProduct' },
                    totalQuantitySold: { $sum: '$Total_Amount' }
                }
            },
            {
                $project: {
                    _id: 0,
                    productName: 1,
                    totalQuantitySold: 1
                }
            },
            {
                $sort: { totalQuantitySold: -1 }
            },
            {
                $limit: 5
            }
        ]);

        console.log("Top 5 popular products data:", productPopularData);
        res.send(productPopularData);

    } catch (error) {
        console.error('Error fetching popular products data:', error);
        res.status(500).send('Failed to fetch popular products data');
    }
});






/* product */
router.get('/stock', async (req, res) => {
    const searchTerm = req.query.searchTerm;
    const sortQuery = req.query.sort; // 'asc' or 'desc'
    const sortOrder = sortQuery === 'asc' ? -1 : 1; // 1 for ascending, -1 for descending
    
    console.log(`Search Term: ${searchTerm}`); // Debug: Log the search term

    try {
        // Build a query object based on the search term and excluding 'น้ำมะพร้าวปั่น'
        let query = {
            NameProduct: { $ne: 'มะพร้าวปั่น' } // Exclude 'น้ำมะพร้าวปั่น'
        };
        if (searchTerm && searchTerm.trim()) {
            query["$and"] = [ // Use $and to combine conditions
                { NameProduct: { $regex: new RegExp(searchTerm, 'i') } }
                // Add more fields if you want to search by other criteria
            ];
            console.log("Running query:", JSON.stringify(query)); // Debug: Log the query
        }

        // Fetch products based on the query
        let list_products = await Product.find(query);

        // Fetch the latest count for each product with sorting
        const counts = await Count_product.aggregate([
            { $sort: { CountDate: -1 } }, // Sort by CountDate descending
            { $group: { _id: "$Product_ID", remaining: { $first: "$remaining" } } }, // Group by Product_ID and take the first (latest) remaining count
            { $sort: { remaining: sortOrder } } // Sort by remaining count based on sortOrder
        ]);

        // Convert counts to a map for easy lookup
        const countsMap = new Map(counts.map(count => [count._id.toString(), count.remaining]));

        // Merge product and count data with sorting
        let mergedList = list_products.map(product => {
            return {
                ...product.toObject(),
                remaining: countsMap.get(product.Product_ID.toString()) || 0 // Default to 0 if no count found
            };
        });

        // Sort the merged list based on remaining count
        mergedList = mergedList.sort((a, b) => sortOrder * (a.remaining - b.remaining));

        // Log the count of products being sent to the template
        console.log(`Products Count Being Rendered: ${mergedList.length}`);

        // Render the page with the merged list
        res.render('stockPage.ejs', {
            list_products: mergedList,
            list_predict_products: global.list_predict_products.length > 0 ? global.list_predict_products : global.list_predict_undata,
            formattedDate: null, 
            notificate_items, 
            notificate_count: notificate_items.length
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching products');
    }
});


/* del product */
router.delete('/product/delete/:id', (req, res) => {
    const productId = req.params.id;
    console.log("Product deletion route hit with ID:", productId);
    
    Product.findByIdAndDelete(productId)
    .then(() => {
        // If related counts are successfully deleted, send success response
        res.json({success: true});
    })
    .catch(err => {
        console.error(err);
        res.status(500).json({success: false, message: 'Error deleting product and related counts'});
    });
});



router.get('/Updatestock', (req, res)=>{
    res.render('insert_product.ejs', {employees_items, notificate_items, notificate_count, formattedDate: null});
})
router.post('/addProduct', upload.single('productImage'),async (req, res) => {
    const file = req.file;
    if (!file) {
        return res.status(400).send('Please upload a file.');
    }
    try {
         // เก็บ path ของไฟล์เพื่อใช้ใน database
         const imagePath = '/img/' + file.filename;  // เปลี่ยน path เพื่อสะท้อนถึงการเปลี่ยนแปลงใหม่
        // Determine Category_ID and Type_ID based on selected category
        const categoryName = req.body.categoryName; // Ensure this matches the name attribute in your form
        const { Category_ID, Type_ID } = categoryMappings[categoryName] || { Category_ID: 1, Type_ID: 1 }; // Default to some category if not found

        // Generating a New Product_ID
        const lastProduct = await Product.findOne().sort('-Product_ID').exec();
        const newProductId = lastProduct && lastProduct.Product_ID ? parseInt(lastProduct.Product_ID) + 1 : 1;
        console.log(`New Product_ID: ${newProductId}`);

        // Saving Product Information
        const newProduct = new Product({
            Product_ID: newProductId,
            Category_ID: Category_ID,
            Type_ID: Type_ID,
            Barcode: req.body.Barcode,
            NameProduct: req.body.NameProduct,
            PricePrduct: req.body.PricePrduct,
            ImageProduct: imagePath,
            DetailProduct: ""
        });
        await newProduct.save();

        // Saving Initial Count Information
        const newCountProduct = new Count_product({
            CountsProduct_ID: newProductId, // Set to 'owner' as per your requirement
            Employee_ID: null,
            Product_ID: newProduct.Product_ID,
            CountDate: new Date(), // Set to current date or another appropriate value
            To_sell: 0,
            Count_sell: 0,
            expire: '0', // Assuming this is a string as per your schema
            remaining: req.body.remaining // Get this from the form submission
        });
        await newCountProduct.save();

        // Redirect or send a response
        res.redirect('/stock'); // Redirect to a success page or another appropriate route
    } catch (err) {
        console.error(err);
        res.status(500).send('Error processing request');
    }
});

router.get('/Import_Product', (req,res)=> {
    res.render('import_product.ejs', {employees_items, notificate_items, notificate_count, formattedDate: null});
})

router.post('/import_product', async (req, res) => {
    try {
        // รวบรวมค่าจากฟอร์ม
        const productNames = [];
        const countSells = [];
        
        for (let i = 1; i <= 9; i++) {
            if (req.body[`productName${i}`] && req.body[`Count_sell${i}`]) {
                productNames.push(req.body[`productName${i}`]);
                countSells.push(req.body[`Count_sell${i}`]);
            }
        }

        // ฟังก์ชันสำหรับการสร้างรูปแบบวันที่
        const getFormattedDate = (date) => {
            let year = date.getFullYear();
            let month = (date.getMonth() + 1).toString().padStart(2, '0');
            let day = date.getDate().toString().padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        const importDate = getFormattedDate(new Date());
        const newImportProducts = [];

        for (let i = 0; i < productNames.length; i++) {
            const productName = productNames[i];
            const countSell = countSells[i];

            // หา Product_ID จากชื่อสินค้า
            const product = id_product[productName];
            if (!product) {
                return res.status(400).json({ error: `Product not found: ${productName}` });
            }

            // สร้างรายการสินค้านำเข้าใหม่
            const newImportProduct = new import_products({
                Employee_ID: 1, // กำหนดค่า Employee_ID เป็น 1
                Product_ID: product.Product_ID,
                ImportDate: importDate,
                Count: countSell
            });

            newImportProducts.push(newImportProduct);
        }

        // พิมพ์ข้อมูลเพื่อการตรวจสอบ
        console.log('Products to be inserted:', newImportProducts);

        // บันทึกลงฐานข้อมูลพร้อมกัน
        await import_products.insertMany(newImportProducts);

        // Redirect ไปที่ /stock หลังจากบันทึกเสร็จ
        res.redirect('/stock');
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'An error occurred while importing the products' });
    }
});






/* staff */
router.get('/staff', async (req, res) => {
    const searchTerm = req.query.searchTerm;
    console.log(`Search Term: ${searchTerm}`); // Debug: Log the search term

    try {
        // Fetch all employees by default
        let employees_items_find = await Employee.find({});

        // If there's a search term and it's not empty, filter the employees
        if (searchTerm && searchTerm.trim()) {
            const searchQuery = {
                $or: [
                    { Name: { $regex: new RegExp(searchTerm, 'i') } },
                    { Username: { $regex: new RegExp(searchTerm, 'i') } }
                ]
            };
            console.log("Running query:", JSON.stringify(searchQuery)); // Debug: Log the query as a string
            employees_items_find = await Employee.find(searchQuery);
        }

        // Log the count of employees being sent to the template
        console.log(`Employees Count Being Rendered: ${employees_items_find.length}`);

        res.render('staff.ejs', {
            employees_items_find: employees_items_find,
            notificate_items, 
            notificate_count, 
            formattedDate: null
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching employees');
    }
});

/* del_staff */
router.delete('/staff/delete/:id', (req, res) => {
    console.log("Search route hit with term:", req.query.term);
    Employee.findByIdAndDelete(req.params.id)
    .then(() => {
        res.json({success: true});
    })
    .catch(err => {
        console.error(err);
        res.status(500).json({success: false, message: 'Error deleting employee'});
    });
});

/* insert_staff */
router.get('/Updatestaff', (req, res)=>{
    res.render('insert_employee.ejs', {employees_items, notificate_items, notificate_count, formattedDate: null});
})
router.post('/addEmployee',upload.single('IMG'), async(req, res)=>{
    const file = req.file;
    if (!file) {
        return res.status(400).send('Please upload a file.');
    }
    try {
        const imagePath = '/img/' + file.filename;  // สร้าง path สำหรับเก็บใน database
        const lastEmployee = await Employee.findOne().sort('-Employee_ID').exec();
        
        const newEmployeeId = lastEmployee && lastEmployee.Employee_ID ? parseInt(lastEmployee.Employee_ID) + 1 : 1;
        console.log(`New Employee_ID: ${newEmployeeId}`);

        const newEmployee = new Employee({
            Employee_ID: newEmployeeId,
            Name: req.body.Name,
            Username: req.body.Username,
            Password: req.body.Password,
            Address_Staff: req.body.Address_Staff,
            Tel_Staff: req.body.Tel_Staff,
            ID_Card: req.body.ID_Card,
            IMG: imagePath
        });
        const savedEmployee = await newEmployee.save().catch(err => console.error(err));
        console.log(newEmployee);
        res.redirect('/staff');
    } catch (err) {
        console.error(err);
        if (err.code === 11000) {
            res.status(400).send('Duplicate Employee_ID. Please try again.');
        } else {
            res.status(500).send('Error processing request');
        }
    }
})


router.get('/nav', (req, res) => {
    res.render('navbar.ejs', { notificate_items, notificate_count: notificate_items.length });
});

/* login */
router.get('/', (req, res)=>{
    res.render('login.ejs', { error: {} });
})
router.post('/', async (req, res, next) => {
    const username = req.body.username;
    const password  = req.body.password;

    if (!username === "" || !password === "") {
        return res.render('login.ejs', { error: { msg: 'Please enter both username and password' } });
    }

    try {
        const user = await Owner.findOne({ Username: username });

        if (!user) {
            return res.render('login.ejs', { error: { msg: 'Invalid credentials' } });
        }

        const isMatch = await user.comparePassword(password);

        if (!isMatch) {
            return res.render('login.ejs', { error: { msg: 'Invalid credentials' } });
        }

        res.redirect('/home');
    } catch (err) {
        next(err);
    }
});


module.exports = router

