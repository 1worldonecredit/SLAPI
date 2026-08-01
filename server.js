require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sql = require('mssql');

const app = express();
const port = process.env.PORT || 5000;

// อนุญาตให้หน้าเว็บจากโดเมนของคุณเรียกใช้ API ได้
const allowedOrigins = [
  'https://salapi.company', 
  'https://api.salapi.company',
  'https://emp.salapi.company',
  'http://localhost:5173',
  'http://localhost:5174'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      var msg = 'CORS Policy: ไม่อนุญาตให้โดเมนนี้เข้าถึง API';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true 
}));

// ขยายขีดจำกัดให้รองรับรูปภาพสลิปที่แปลงเป็น Base64
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ตั้งค่าการเชื่อมต่อฐานข้อมูล
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER, 
    database: process.env.DB_DATABASE,
    options: {
        encrypt: false, 
        trustServerCertificate: true 
    }
};

// ทดสอบเชื่อมต่อฐานข้อมูล
sql.connect(dbConfig).then(() => {
    console.log("✅ เชื่อมต่อฐานข้อมูลสำเร็จ!");
}).catch(err => {
    console.log("❌ ไม่สามารถเชื่อมต่อฐานข้อมูลได้:", err);
});

// ==========================================
// API ทดสอบสถานะเซิร์ฟเวอร์
// ==========================================
app.get('/api/status', (req, res) => {
    res.json({ 
        message_th: 'สวัสดี! API ของคุณทำงานปกติ', 
        message_la: 'ສະບາຍດີ! API ຂອງທ່ານເຮັດວຽກປົກກະຕິ' 
    });
});

app.get('/api/admin/test-db-connection', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request().query(`
      SELECT TOP 1 un.firstname, un.lastname, u.country 
      FROM Users u
      LEFT JOIN UserName_Lastname un ON u.user_id = un.user_id
    `);
    if (result.recordset.length > 0) {
      res.json({ success: true, data: result.recordset[0] });
    } else {
      res.json({ success: false, message: 'ไม่พบข้อมูล' });
    }
  } catch (err) {
    console.error('DB Test Error:', err);
    res.status(500).json({ success: false, message: 'Database Error' });
  }
});


// ==========================================
// 🌟 1. ระบบเมนูอัจฉริยะ (Dynamic Menu)
// ==========================================
app.get('/api/menus', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig); 
        const result = await pool.request().query(`
            SELECT 
                menu_id AS id, title, path, icon, component, 
                parent_id AS parentId, show_notification AS showNotification
            FROM System_Menus
            ORDER BY parent_id, sort_order, menu_id
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching menus:', err);
        res.status(500).send('Server error');
    }
});

app.post('/api/menus', async (req, res) => {
    const { title, path, icon, component, parentId, showNotification } = req.body;
    try {
        const pool = await sql.connect(dbConfig); 
        const result = await pool.request()
            .input('title', sql.NVarChar, title).input('path', sql.VarChar, path || null)
            .input('icon', sql.VarChar, icon || null).input('component', sql.VarChar, component || null)
            .input('parent_id', sql.Int, parentId || null).input('show_notification', sql.Bit, showNotification === false ? 0 : 1)
            .query(`
                INSERT INTO System_Menus (title, path, icon, component, parent_id, show_notification)
                OUTPUT INSERTED.menu_id AS id
                VALUES (@title, @path, @icon, @component, @parent_id, @show_notification)
            `);
        res.status(201).json({ message: 'บันทึกเมนูสำเร็จ', id: result.recordset[0].id });
    } catch (err) {
        console.error('Error saving menu:', err);
        res.status(500).send('Server error');
    }
});

app.put('/api/menus/:id', async (req, res) => {
    const { id } = req.params;
    const { title, path, icon, component, parentId, showNotification } = req.body;
    try {
        const pool = await sql.connect(dbConfig); 
        await pool.request()
            .input('id', sql.Int, id).input('title', sql.NVarChar, title)
            .input('path', sql.VarChar, path || null).input('icon', sql.VarChar, icon || null)
            .input('component', sql.VarChar, component || null).input('parent_id', sql.Int, parentId || null)
            .input('show_notification', sql.Bit, showNotification === false ? 0 : 1)
            .query(`
                UPDATE System_Menus 
                SET title = @title, path = @path, icon = @icon, component = @component, 
                    parent_id = @parent_id, show_notification = @show_notification
                WHERE menu_id = @id
            `);
        res.json({ message: 'อัปเดตเมนูสำเร็จ' });
    } catch (err) {
        console.error('Error updating menu:', err);
        res.status(500).send('Server error');
    }
});

app.delete('/api/menus/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await sql.connect(dbConfig); 
        await pool.request().input('id', sql.Int, id).query(`
                DELETE FROM System_Menus WHERE parent_id = @id;
                DELETE FROM System_Menus WHERE menu_id = @id;
            `);
        res.json({ message: 'ลบเมนูสำเร็จ' });
    } catch (err) {
        console.error('Error deleting menu:', err);
        res.status(500).send('Server error');
    }
});


// ==========================================
// 🌟 2. ระบบผู้ใช้งาน (Auth / Register / Login)
// ==========================================
app.get('/api/check-referrer/:username', async (req, res) => {
  const username = req.params.username;
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request().input('username', sql.VarChar, username).query(`
        SELECT u.username, un.firstname, un.lastname
        FROM Users u LEFT JOIN UserName_Lastname un ON u.user_id = un.user_id
        WHERE u.username = @username
      `);
    if (result.recordset.length > 0) {
      const user = result.recordset[0];
      const fullName = `${user.firstname || ''} ${user.lastname || ''}`.trim() || 'ผู้ใช้ทั่วไป';
      res.json({ exists: true, fullName: fullName });
    } else {
      res.json({ exists: false, message: 'ไม่พบผู้แนะนำ' });
    }
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้อง' });
  }
});

app.get('/api/check-username/:username', async (req, res) => {
  const username = req.params.username;
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request().input('username', sql.VarChar, username)
      .query('SELECT username FROM Users WHERE username = @username');
    if (result.recordset.length > 0) {
      res.json({ available: false }); 
    } else {
      res.json({ available: true });  
    }
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/register', async (req, res) => {
  const { username, password, referrer, country } = req.body;
  try {
    const pool = await sql.connect(dbConfig);
    const checkUser = await pool.request().input('username', sql.NVarChar, username).query('SELECT username FROM Users WHERE username = @username');
    if (checkUser.recordset.length > 0) {
      return res.status(400).json({ success: false, message: 'ชื่อผู้ใช้นี้มีคนใช้แล้ว' });
    }

    let currencyCode = 'THB'; 
    let selectedCountry = country || 'Thailand';
    if (selectedCountry.toLowerCase() === 'laos') currencyCode = 'LAK';
    const role_id = 4;  
    const level_id = 1; 

    const insertResult = await pool.request()
      .input('username', sql.NVarChar, username).input('password', sql.NVarChar, password) 
      .input('referrer', sql.NVarChar, referrer || null).input('country', sql.NVarChar, selectedCountry)
      .input('currency_code', sql.VarChar, currencyCode).input('role_id', sql.Int, role_id).input('level_id', sql.Int, level_id)
      .query(`
        INSERT INTO Users (username, password_hash, referrer_username, country, currency_code, role_id, level_id, is_active, created_at, wallet_balance, total_orders)
        OUTPUT INSERTED.user_id
        VALUES (@username, @password, @referrer, @country, @currency_code, @role_id, @level_id, 1, GETDATE(), 0, 0)
      `);
      
    const newUserId = insertResult.recordset[0].user_id;

    await pool.request().input('user_id', sql.Int, newUserId).query(`
        INSERT INTO UserName_Lastname (user_id, firstname, lastname) VALUES (@user_id, N'ผู้ใช้', N'ใหม่');
        INSERT INTO Wallets (user_id, balance, points) VALUES (@user_id, 0, 0);
      `);

    res.json({ success: true, message: 'สมัครสมาชิกสำเร็จ' });
  } catch (err) {
    console.error('Register API Error:', err);
    res.status(500).json({ success: false, message: 'ระบบขัดข้อง ไม่สามารถบันทึกข้อมูลได้' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const pool = await sql.connect(dbConfig);
    const userResult = await pool.request().input('username', sql.VarChar, username).query(`
        SELECT 
          u.user_id, u.username, u.password_hash, u.wallet_balance, u.total_orders, u.is_active,
          u.country, u.currency_code, 
          un.firstname, un.lastname,
          r.role_id, r.role_name,
          cl.level_id, cl.level_name
        FROM Users u
        LEFT JOIN UserName_Lastname un ON u.user_id = un.user_id
        LEFT JOIN Roles r ON u.role_id = r.role_id
        LEFT JOIN CustomerLevels cl ON u.level_id = cl.level_id
        WHERE u.username = @username
      `);

    if (userResult.recordset.length === 0) return res.status(401).json({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    const user = userResult.recordset[0];
    if (!user.is_active) return res.status(403).json({ message: 'บัญชีนี้ถูกระงับการใช้งาน' });
    if (password !== user.password_hash) return res.status(401).json({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });

    res.json({
      success: true, 
      message: 'เข้าสู่ระบบสำเร็จ',
      user: {
        id: user.user_id, user_id: user.user_id, username: user.username,
        firstname: user.firstname || 'ผู้ใช้', lastname: user.lastname || '',
        country: user.country || 'Thailand', currency_code: user.currency_code || 'THB',
        role_id: user.role_id, role_name: user.role_name || 'User',
        level_id: user.level_id, level_name: user.level_name || 'ลูกค้าใหม่',
        wallet: user.wallet_balance || 0.00, point: 0 
      }
    });
  } catch (err) {
    console.error('Login API Error:', err);
    res.status(500).json({ message: 'ระบบขัดข้อง ไม่สามารถเชื่อมต่อฐานข้อมูลได้ในขณะนี้' });
  }
});


// ==========================================
// 🌟 3. ระบบข้อมูล Dashboard & การเงิน (กระเป๋าเงิน / อัตราแลกเปลี่ยน)
// ==========================================
app.get('/api/dashboard/:userId', async (req, res) => {
  const userId = req.params.userId;
  try {
    const pool = await sql.connect(dbConfig);
    const walletResult = await pool.request().input('user_id', sql.Int, userId).query('SELECT balance, points FROM Wallets WHERE user_id = @user_id');
    let wallet = walletResult.recordset[0];
    if (!wallet) wallet = { balance: 0.00, points: 0 };

    const txResult = await pool.request().input('user_id', sql.Int, userId).query(`
        SELECT TOP 5 transaction_id, transaction_type, title, amount, status, created_at 
        FROM Transactions WHERE user_id = @user_id ORDER BY created_at DESC
      `);
    res.json({ wallet: wallet, recentTransactions: txResult.recordset });
  } catch (err) {
    res.status(500).json({ message: 'DB Error' });
  }
});

app.get('/api/transactions/:userId', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().input('userId', sql.Int, req.params.userId).query(`
                SELECT * FROM Transactions WHERE user_id = @userId ORDER BY created_at DESC
            `);
        res.status(200).json({ success: true, data: result.recordset });
    } catch (error) {
        res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลประวัติการเงินได้' });
    }
});

app.get('/api/exchange-rates', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request().query('SELECT currency_pair, rate, last_updated FROM ExchangeRates');
    const rates = {};
    let lastUpdated = null;
    result.recordset.forEach(row => {
      rates[row.currency_pair] = row.rate;
      if (!lastUpdated) lastUpdated = row.last_updated; 
    });
    res.json({ success: true, rates: rates, last_updated: lastUpdated });
  } catch (err) {
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลอัตราแลกเปลี่ยนได้' });
  }
});


// ==========================================
// 🌟 4. ระบบบัญชีธนาคาร (User Banks & System Banks)
// ==========================================
app.get('/api/banks', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request().query('SELECT * FROM Banks WHERE is_active = 1');
    res.json({ success: true, banks: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลธนาคารได้' });
  }
});

app.get('/api/admin/banks', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request().query("SELECT * FROM Banks WHERE is_active = 1");
    res.json({ success: true, banks: result.recordset });
  } catch (error) {
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลธนาคารได้' });
  }
});

app.get('/api/user-profile-banks/:userId', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const userId = req.params.userId;
    const nameResult = await pool.request().input('userId', sql.Int, userId).query('SELECT firstname, lastname FROM UserName_Lastname WHERE user_id = @userId');
    const bankResult = await pool.request().input('userId', sql.Int, userId).query(`
        SELECT ub.*, b.bank_name, b.logo_url 
        FROM UserBanks ub JOIN Banks b ON ub.bank_id = b.bank_id WHERE ub.user_id = @userId
      `);
    res.json({ success: true, profile: nameResult.recordset[0] || null, userBanks: bankResult.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'ระบบขัดข้อง' });
  }
});

app.post('/api/add-user-bank', async (req, res) => {
  const { userId, firstname, lastname, bankId, accountName, accountNumber, currencyCode, passbookBase64 } = req.body;
  try {
    const pool = await sql.connect(dbConfig);
    await pool.request()
      .input('userId', sql.Int, userId).input('fname', sql.NVarChar, firstname).input('lname', sql.NVarChar, lastname)
      .query('UPDATE UserName_Lastname SET firstname = @fname, lastname = @lname WHERE user_id = @userId');

    await pool.request()
      .input('userId', sql.Int, userId).input('bankId', sql.Int, bankId)
      .input('accountName', sql.NVarChar, accountName).input('accountNumber', sql.VarChar, accountNumber)
      .input('currency', sql.VarChar, currencyCode).input('passbook', sql.VarChar(sql.MAX), passbookBase64)
      .query(`
        INSERT INTO UserBanks (user_id, bank_id, account_name, account_number, currency_code, is_primary, passbook_image, status, created_at)
        VALUES (@userId, @bankId, @accountName, @accountNumber, @currency, 1, @passbook, 'Pending', GETDATE())
      `);
    res.json({ success: true, message: 'เพิ่มบัญชีธนาคารสำเร็จ กรุณารอแอดมินตรวจสอบ' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'ไม่สามารถเพิ่มบัญชีได้' });
  }
});

app.get('/api/admin/customer-banks', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request().query(`
      SELECT ub.user_bank_id, ub.account_name, ub.account_number, ub.is_primary, ub.created_at, ub.currency_code, ub.status, u.username, b.bank_name
      FROM UserBanks ub LEFT JOIN Users u ON ub.user_id = u.user_id LEFT JOIN Banks b ON ub.bank_id = b.bank_id ORDER BY ub.created_at DESC
    `);
    res.json({ success: true, banks: result.recordset });
  } catch (error) {
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลบัญชี' });
  }
});

app.get('/api/admin/user-banks', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query(`
            SELECT ub.user_bank_id, ub.user_id, ub.bank_id, ub.account_name, ub.account_number, ub.is_primary, ub.created_at, ub.currency_code, ub.status, un.firstname, un.lastname
            FROM UserBanks ub LEFT JOIN UserName_Lastname un ON ub.user_id = un.user_id ORDER BY ub.created_at DESC
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/admin/user-banks/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status, user_id, admin_name, reject_reason } = req.body; 
    try {
        const pool = await sql.connect(dbConfig);
        await pool.request().input('id', sql.Int, id).input('status', sql.VarChar, status).query(`UPDATE UserBanks SET status = @status WHERE user_bank_id = @id`);
        
        const notifMessage = status === 'Approved' ? `บัญชีธนาคาร ${reject_reason || ''} ของคุณได้รับการอนุมัติเรียบร้อยแล้ว` : `คำขอเพิ่มบัญชีถูกปฏิเสธ: ${reject_reason || 'ข้อมูลไม่ถูกต้อง'}`;
        await pool.request().input('user_id', sql.Int, user_id).input('message', sql.NVarChar, notifMessage).query(`
                INSERT INTO Notifications (user_id, message, is_read, created_at) VALUES (@user_id, @message, 0, GETDATE())
            `);
        res.json({ success: true, message: 'บันทึกข้อมูลและส่งแจ้งเตือนสำเร็จ' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/admin/verify-customer-bank', async (req, res) => {
  const { userBankId, action } = req.body; 
  if (!userBankId || !action) return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });
  try {
    const pool = await sql.connect(dbConfig);
    await pool.request().input('id', sql.Int, userBankId).input('status', sql.VarChar, action).query("UPDATE UserBanks SET status = @status WHERE user_bank_id = @id");
    res.json({ success: true, message: action === 'Approved' ? 'อนุมัติบัญชีสำเร็จ' : 'ปฏิเสธบัญชีสำเร็จ' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'ระบบเซิร์ฟเวอร์ขัดข้อง' });
  }
});


// ==========================================
// 🌟 5. ระบบแจ้งฝากเงิน (Deposit & Double Verification)
// ==========================================
// User: แจ้งฝากเงิน (บังคับรอแอดมินตรวจเสมอ)
app.post('/api/deposit-submit', async (req, res) => {
  try {
    const { userId, bankName, accountNumber, currencyCode, amount, depositDate, depositTime, slipBase64 } = req.body;
    const cleanAmount = Math.round(parseFloat(amount) * 100) / 100; 
    const depositDatetime = `${depositDate} ${depositTime}`;
    const pool = await sql.connect(dbConfig); 

    const userResult = await pool.request().input('searchUserId', sql.Int, userId).query(`SELECT username FROM Users WHERE user_id = @searchUserId`);
    let customerName = 'ไม่ระบุชื่อ'; 
    if (userResult.recordset.length > 0) customerName = userResult.recordset[0].username;

    await pool.request()
      .input('userId', sql.Int, userId).input('customerName', sql.NVarChar(100), customerName)
      .input('bankName', sql.NVarChar(100), bankName || '').input('accountNumber', sql.VarChar(50), accountNumber || '')
      .input('amount', sql.Decimal(18, 2), cleanAmount).input('currencyCode', sql.VarChar(10), currencyCode || 'THB')
      .input('slipImage', sql.NVarChar(sql.MAX), slipBase64).input('depositDatetime', sql.DateTime, depositDatetime) 
      .query(`
        INSERT INTO Transactions_Deposit (user_id, customer_name, bank_name, account_number, amount, currency_code, slip_image, status, deposit_datetime, created_at)
        VALUES (@userId, @customerName, @bankName, @accountNumber, @amount, @currencyCode, @slipImage, 'Pending', @depositDatetime, GETDATE())
      `);

    res.json({ success: true, message: 'ส่งคำขอฝากเงินสำเร็จ! รอแอดมินตรวจสอบสลิป' });
  } catch (error) {
    console.error('Error in deposit-submit:', error);
    res.status(500).json({ success: false, message: 'เซิร์ฟเวอร์ขัดข้อง: ' + error.message });
  }
});

// User: แก้ไขบิลที่ถูกตีกลับ
app.put('/api/deposit-edit/:id', async (req, res) => {
  try {
    const depositId = req.params.id;
    const { amount, depositDate, depositTime, slipBase64 } = req.body;
    const depositDatetime = `${depositDate} ${depositTime}`;
    const cleanAmount = Math.round(parseFloat(amount) * 100) / 100;
    const pool = await sql.connect(dbConfig);
    
    await pool.request()
      .input('id', sql.Int, depositId).input('amount', sql.Decimal(18,2), cleanAmount)
      .input('depositDatetime', sql.DateTime, depositDatetime).input('slipImage', sql.NVarChar(sql.MAX), slipBase64)
      .query(`
        UPDATE Transactions_Deposit
        SET amount = @amount, deposit_datetime = @depositDatetime, slip_image = @slipImage,
            status = 'Pending', reviewed_by = 'User Updated', reject_reasons = NULL
        WHERE deposit_id = @id
      `);
    res.json({ success: true, message: 'ส่งคำขอที่แก้ไขแล้วเรียบร้อย กรุณารอแอดมินตรวจสอบ' });
  } catch(error) {
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูลแก้ไข' });
  }
});

// User: ดึงประวัติฝากเงิน
app.get('/api/user/deposits/:userId', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const query = `
      SELECT deposit_id, amount, currency_code, status, reject_reasons, 
             FORMAT(deposit_datetime, 'yyyy-MM-dd HH:mm:ss') AS deposit_datetime,
             FORMAT(created_at, 'yyyy-MM-dd HH:mm:ss') AS created_at
      FROM Transactions_Deposit WHERE user_id = @userId ORDER BY created_at DESC
    `;
    const result = await pool.request().input('userId', sql.Int, req.params.userId).query(query);
    res.json({ success: true, history: result.recordset });
  } catch (error) {
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงประวัติ' });
  }
});

// Admin: ดึงรายการฝากเพื่อตรวจสอบ
app.get('/api/admin/deposit-requests', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const queryList = `
      SELECT deposit_id, user_id, customer_name, bank_name, account_number, amount, currency_code, slip_image, status, 
             FORMAT(deposit_datetime, 'yyyy-MM-ddTHH:mm:ss') AS deposit_datetime, FORMAT(created_at, 'yyyy-MM-ddTHH:mm:ss') AS created_at, 
             reject_reasons, edit_count
      FROM Transactions_Deposit WHERE status = 'Pending' OR CAST(created_at AS DATE) = CAST(GETDATE() AS DATE) ORDER BY created_at DESC
    `;
    const resultList = await pool.request().query(queryList);

    const querySummary = `
      SELECT t.currency_code, ISNULL(SUM(t.amount), 0) as total_amount
      FROM Transactions_Deposit t INNER JOIN Bank_Statements b ON t.deposit_id = b.reconciled_with_deposit_id
      WHERE t.status = 'Approved' AND MONTH(t.created_at) = MONTH(GETDATE()) AND YEAR(t.created_at) = YEAR(GETDATE())
      GROUP BY t.currency_code
    `;
    const resultSummary = await pool.request().query(querySummary);
    const monthlySummary = {};
    resultSummary.recordset.forEach(row => { monthlySummary[row.currency_code] = row.total_amount; });

    res.json({ success: true, requests: resultList.recordset, summary: monthlySummary });
  } catch (error) {
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
  }
});

// Admin: ตีกลับสลิป + แจ้งเตือนสแปม
app.post('/api/admin/deposit-reject', async (req, res) => {
  try {
    const { depositId, userId, rejectReasons } = req.body;
    const pool = await sql.connect(dbConfig);
    const reasonsJson = JSON.stringify(rejectReasons);

    const updateResult = await pool.request()
      .input('depositId', sql.Int, depositId).input('reasons', sql.NVarChar, reasonsJson)
      .query(`
        UPDATE Transactions_Deposit SET status = 'Rejected', reviewed_by = 'Admin (Returned)', reject_reasons = @reasons, edit_count = ISNULL(edit_count, 0) + 1
        OUTPUT INSERTED.edit_count WHERE deposit_id = @depositId
      `);
      
    const currentEditCount = updateResult.recordset[0].edit_count;
    let isSpammer = false;
    let spamReason = '';

    if (currentEditCount > 3) {
      isSpammer = true;
      spamReason = `แก้ไขคำขอเดิมผิดพลาดเกิน 3 ครั้ง (Deposit ID: ${depositId})`;
    }
    if (!isSpammer) {
      const checkDailySpam = await pool.request().input('userId', sql.Int, userId).query(`
        SELECT COUNT(*) as pending_count FROM Transactions_Deposit WHERE user_id = @userId AND status IN ('Pending', 'Rejected') AND CAST(created_at AS DATE) = CAST(GETDATE() AS DATE)
      `);
      if (checkDailySpam.recordset[0].pending_count >= 10) {
        isSpammer = true;
        spamReason = 'ส่งคำขอฝากเงินที่ไม่สำเร็จ/ตีกลับ เกิน 10 รายการใน 1 วัน';
      }
    }
    if (isSpammer) {
      await pool.request().input('userId', sql.Int, userId).input('reason', sql.NVarChar, spamReason)
        .query(`UPDATE Users SET is_suspicious = 1, suspicious_reason = @reason WHERE user_id = @userId`);
      return res.json({ success: true, message: 'ส่งกลับให้ลูกค้าแก้ไขแล้ว! ⚠️ แจ้งเตือน: ระบบตรวจพบพฤติกรรมก่อกวนจากลูกค้ารายนี้ และได้ทำเครื่องหมายเฝ้าระวังแล้ว', isSuspicious: true });
    }
    res.json({ success: true, message: 'ส่งกลับให้ลูกค้าแก้ไขเรียบร้อยแล้ว' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการตีกลับรายการ' });
  }
});

// Admin: ตรวจสลิป (กุญแจดอก 1)
app.post('/api/admin/deposit-approve', async (req, res) => {
  try {
    const { depositId, userId, amount } = req.body;
    const pool = await sql.connect(dbConfig);
    const depData = await pool.request().input('depositId', sql.Int, depositId).query("SELECT * FROM Transactions_Deposit WHERE deposit_id = @depositId");
    if(depData.recordset.length === 0) return res.status(404).json({ success: false, message: 'ไม่พบข้อมูล' });
    const dep = depData.recordset[0];

    const findBankStmt = await pool.request()
      .input('accountNumber', sql.VarChar, dep.account_number).input('amount', sql.Decimal(18,2), dep.amount)
      .input('transferDate', sql.VarChar, dep.deposit_datetime.toISOString().split('T')[0])
      .input('transferTime', sql.VarChar, dep.deposit_datetime.toISOString().split('T')[1].substring(0, 8))
      .query(`
        SELECT TOP 1 statement_id FROM Bank_Statements WHERE is_reconciled = 0 AND account_number = @accountNumber AND ABS(amount - @amount) <= 0.01
          AND CAST(transfer_date AS DATE) = CAST(@transferDate AS DATE) AND CAST(transfer_time AS TIME(0)) = CAST(@transferTime AS TIME(0))
      `);

    if (findBankStmt.recordset.length > 0) {
      const stmtId = findBankStmt.recordset[0].statement_id;
      await pool.request().input('depositId', sql.Int, depositId).query("UPDATE Transactions_Deposit SET status = 'Approved', reviewed_by = 'Admin (Matched)' WHERE deposit_id = @depositId");
      await pool.request().input('userId', sql.Int, userId).input('amount', sql.Decimal(18,2), amount).query("UPDATE Wallets SET balance = ISNULL(balance, 0) + @amount, last_updated = GETDATE() WHERE user_id = @userId");
      await pool.request().input('userId', sql.Int, userId).input('amount', sql.Decimal(18,2), amount).input('title', sql.NVarChar(255), 'ฝากเงิน (สำเร็จ)').query("INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at) VALUES (@userId, 'Deposit', @title, @amount, 'Completed', GETDATE())");
      await pool.request().input('stmtId', sql.Int, stmtId).input('depositId', sql.Int, depositId).query("UPDATE Bank_Statements SET is_reconciled = 1, reconciled_with_deposit_id = @depositId WHERE statement_id = @stmtId");
      return res.json({ success: true, message: 'ตรวจสลิปผ่าน และระบบจับคู่กับยอดธนาคารสำเร็จ! (เติมเงินเข้า Wallet แล้ว)' });
    } else {
      await pool.request().input('depositId', sql.Int, depositId).query("UPDATE Transactions_Deposit SET status = 'Pending', reviewed_by = 'Slip Verified' WHERE deposit_id = @depositId");
      return res.json({ success: true, message: 'บันทึกการตรวจรูปสลิปแล้ว! (รอฝ่ายบัญชีคีย์ยอดให้ตรงกัน ระบบถึงจะจ่ายเงิน)' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการอนุมัติ' });
  }
});

// Admin: บัญชีคีย์ยอด (กุญแจดอก 2)
app.post('/api/admin/key-statement', async (req, res) => {
  try {
    const { bankId, bankName, accountNumber, amount, transferDate, transferTime, adminName } = req.body;
    let cleanTime = transferTime.trim();
    if (cleanTime.toLowerCase().includes('am') || cleanTime.toLowerCase().includes('pm')) {
      const [time, modifier] = cleanTime.split(' ');
      let [hours, minutes, seconds] = time.split(':');
      if (hours === '12') hours = '00';
      if (modifier.toUpperCase() === 'PM') hours = parseInt(hours, 10) + 12;
      cleanTime = `${hours}:${minutes}:${seconds || '00'}`;
    }
    if (cleanTime.length === 5) cleanTime += ':00';
    const cleanAmount = Math.round(parseFloat(amount) * 100) / 100;
    const pool = await sql.connect(dbConfig);

    const insertStmt = await pool.request()
      .input('bankId', sql.Int, bankId).input('bankName', sql.NVarChar, bankName).input('accountNumber', sql.VarChar, accountNumber)
      .input('amount', sql.Decimal(18,2), cleanAmount).input('transferDate', sql.VarChar, transferDate).input('transferTime', sql.VarChar, cleanTime).input('recordedBy', sql.NVarChar, adminName)
      .query(`
        INSERT INTO Bank_Statements (bank_id, bank_name, account_number, amount, transfer_date, transfer_time, recorded_by, is_reconciled) OUTPUT INSERTED.statement_id
        VALUES (@bankId, @bankName, @accountNumber, @amount, CAST(@transferDate AS DATE), CAST(@transferTime AS TIME(0)), @recordedBy, 0)
      `);
    const statementId = insertStmt.recordset[0].statement_id;

    const findSlip = await pool.request()
      .input('amount', sql.Decimal(18,2), cleanAmount).input('accountNumber', sql.VarChar, accountNumber).input('transferDate', sql.VarChar, transferDate).input('transferTime', sql.VarChar, cleanTime)
      .query(`
        SELECT TOP 1 deposit_id, user_id FROM Transactions_Deposit 
        WHERE status = 'Pending' AND reviewed_by = 'Slip Verified' AND account_number = @accountNumber AND ABS(amount - @amount) <= 0.01
          AND CAST(deposit_datetime AS DATE) = CAST(@transferDate AS DATE) AND CAST(deposit_datetime AS TIME(0)) = CAST(@transferTime AS TIME(0))
      `);

    if (findSlip.recordset.length > 0) {
      const match = findSlip.recordset[0];
      await pool.request().input('depositId', sql.Int, match.deposit_id).query("UPDATE Transactions_Deposit SET status = 'Approved', reviewed_by = 'Bank (Matched)' WHERE deposit_id = @depositId");
      await pool.request().input('userId', sql.Int, match.user_id).input('amount', sql.Decimal(18,2), cleanAmount).query("UPDATE Wallets SET balance = ISNULL(balance, 0) + @amount, last_updated = GETDATE() WHERE user_id = @userId");
      await pool.request().input('userId', sql.Int, match.user_id).input('amount', sql.Decimal(18,2), cleanAmount).input('title', sql.NVarChar(255), 'ฝากเงิน (สำเร็จ)').query("INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at) VALUES (@userId, 'Deposit', @title, @amount, 'Completed', GETDATE())");
      await pool.request().input('stmtId', sql.Int, statementId).input('depositId', sql.Int, match.deposit_id).query("UPDATE Bank_Statements SET is_reconciled = 1, reconciled_with_deposit_id = @depositId WHERE statement_id = @stmtId");
      return res.json({ success: true, message: 'คีย์ยอดสำเร็จ และระบบจับคู่กับสลิปที่แอดมินตรวจไว้แล้ว! (เติมเงินเข้า Wallet แล้ว)' });
    }
    res.json({ success: true, message: 'บันทึกยอดเงินเข้าธนาคารสำเร็จ (รอแอดมินตรวจรูปสลิปให้ตรงกัน ระบบถึงจะจ่ายเงิน)' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'ระบบขัดข้อง: ' + error.message });
  }
});

// Admin: แก้ไขยอดบัญชีที่คีย์ผิด
app.put('/api/admin/key-statement/:id', async (req, res) => {
  try {
    const statementId = req.params.id;
    const { bankId, bankName, accountNumber, amount, transferDate, transferTime } = req.body;
    let cleanTime = transferTime.trim();
    if (cleanTime.toLowerCase().includes('am') || cleanTime.toLowerCase().includes('pm')) {
      const [time, modifier] = cleanTime.split(' ');
      let [hours, minutes, seconds] = time.split(':');
      if (hours === '12') hours = '00';
      if (modifier.toUpperCase() === 'PM') hours = parseInt(hours, 10) + 12;
      cleanTime = `${hours}:${minutes}:${seconds || '00'}`;
    }
    if (cleanTime.length === 5) cleanTime += ':00';
    const cleanAmount = Math.round(parseFloat(amount) * 100) / 100;
    const pool = await sql.connect(dbConfig);
    
    const checkStmt = await pool.request().input('id', sql.Int, statementId).query("SELECT is_reconciled FROM Bank_Statements WHERE statement_id = @id");
    if (checkStmt.recordset.length === 0) return res.status(404).json({ success: false, message: 'ไม่พบข้อมูล' });
    if (checkStmt.recordset[0].is_reconciled) return res.status(400).json({ success: false, message: 'ไม่อนุญาตให้แก้ไข! รายการนี้กระทบยอดสำเร็จไปแล้ว' });

    await pool.request()
      .input('id', sql.Int, statementId).input('bankId', sql.Int, bankId).input('bankName', sql.NVarChar, bankName)
      .input('accountNumber', sql.VarChar, accountNumber).input('amount', sql.Decimal(18,2), cleanAmount)
      .input('transferDate', sql.VarChar, transferDate).input('transferTime', sql.VarChar, cleanTime)
      .query(`UPDATE Bank_Statements SET bank_id = @bankId, bank_name = @bankName, account_number = @accountNumber, amount = @amount, transfer_date = CAST(@transferDate AS DATE), transfer_time = CAST(@transferTime AS TIME(0)) WHERE statement_id = @id`);

    const findSlip = await pool.request()
      .input('amount', sql.Decimal(18,2), cleanAmount).input('accountNumber', sql.VarChar, accountNumber).input('transferDate', sql.VarChar, transferDate).input('transferTime', sql.VarChar, cleanTime)
      .query(`
        SELECT TOP 1 deposit_id, user_id FROM Transactions_Deposit 
        WHERE status = 'Pending' AND reviewed_by = 'Slip Verified' AND account_number = @accountNumber AND ABS(amount - @amount) <= 0.01
          AND CAST(deposit_datetime AS DATE) = CAST(@transferDate AS DATE) AND CAST(deposit_datetime AS TIME(0)) = CAST(@transferTime AS TIME(0))
      `);

    if (findSlip.recordset.length > 0) {
      const match = findSlip.recordset[0];
      await pool.request().input('depositId', sql.Int, match.deposit_id).query("UPDATE Transactions_Deposit SET status = 'Approved', reviewed_by = 'Bank (Matched)' WHERE deposit_id = @depositId");
      await pool.request().input('userId', sql.Int, match.user_id).input('amount', sql.Decimal(18,2), cleanAmount).query("UPDATE Wallets SET balance = ISNULL(balance, 0) + @amount, last_updated = GETDATE() WHERE user_id = @userId");
      await pool.request().input('userId', sql.Int, match.user_id).input('amount', sql.Decimal(18,2), cleanAmount).input('title', sql.NVarChar(255), 'ฝากเงิน (สำเร็จ)').query("INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at) VALUES (@userId, 'Deposit', @title, @amount, 'Completed', GETDATE())");
      await pool.request().input('stmtId', sql.Int, statementId).input('depositId', sql.Int, match.deposit_id).query("UPDATE Bank_Statements SET is_reconciled = 1, reconciled_with_deposit_id = @depositId WHERE statement_id = @stmtId");
      return res.json({ success: true, message: 'แก้ไขสำเร็จ และระบบจับคู่กับสลิปได้พอดี! (จ่ายเงินแล้ว)' });
    }
    res.json({ success: true, message: 'แก้ไขข้อมูลสำเร็จ (รอกระทบยอด)' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'ระบบขัดข้อง' });
  }
});

// Admin: รายงานสรุป
app.get('/api/admin/statement-report', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const pool = await sql.connect(dbConfig);
    let query = `
      SELECT bs.*, FORMAT(CAST(bs.transfer_time AS DATETIME), 'HH:mm:ss') AS time_formatted, ISNULL(bk.currency, 'THB') AS currency
      FROM Bank_Statements bs LEFT JOIN Banks bk ON bs.bank_id = bk.bank_id WHERE 1=1
    `;
    if (startDate && endDate) query += ` AND bs.transfer_date >= '${startDate}' AND bs.transfer_date <= '${endDate}'`;
    query += " ORDER BY bs.created_at DESC";
    const records = await pool.request().query(query);

    const summaryQuery = `
      SELECT bk.bank_name, bk.account_number, ISNULL(bk.currency, 'THB') AS currency,
        ISNULL(SUM(CASE WHEN CAST(bs.transfer_date AS DATE) = CAST(GETDATE() AS DATE) THEN bs.amount ELSE 0 END), 0) AS todayTotal,
        ISNULL(SUM(CASE WHEN MONTH(bs.transfer_date) = MONTH(GETDATE()) AND YEAR(bs.transfer_date) = YEAR(GETDATE()) THEN bs.amount ELSE 0 END), 0) AS monthlyTotal
      FROM Bank_Statements bs LEFT JOIN Banks bk ON bs.bank_id = bk.bank_id GROUP BY bk.bank_name, bk.account_number, bk.currency
    `;
    const summaryRecords = await pool.request().query(summaryQuery);
    res.json({ success: true, records: records.recordset, summary: summaryRecords.recordset });
  } catch (error) {
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงรายงานได้' });
  }
});


// ==========================================
// 🌟 6. ระบบหวย (Lottery)
// ==========================================
app.get('/api/admin/animal-numbers', async (req, res) => {
    try {
        try { await sql.connect(dbConfig); } catch (err) { }
        const result = await new sql.Request().query(`SELECT * FROM Master_Animal_Numbers ORDER BY created_at DESC`);
        res.status(200).json(result.recordset);
    } catch (error) {
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลจาก Database', error: error.message });
    }
});

app.post('/api/admin/animal-numbers', async (req, res) => {
    const { animal_name_th, image_url, lottery_type, num1, num2, num3, is_active, action_by } = req.body;
    try {
        const pool = await sql.connect(dbConfig); 
        const checkQuery = await pool.request().input('lotteryType', sql.VarChar, lottery_type).query(`SELECT num1, num2, num3 FROM Master_Animal_Numbers WHERE lottery_type = @lotteryType`);
        const existingNumbers = checkQuery.recordset.flatMap(row => [row.num1, row.num2, row.num3]);
        const newNumbers = [num1, num2];
        if (num3 !== '-') newNumbers.push(num3);
        const duplicates = newNumbers.filter(n => existingNumbers.includes(n));
        
        if (duplicates.length > 0) return res.status(400).json({ success: false, message: `เลข ${duplicates.join(', ')} ถูกใช้ไปแล้วในโหมด ${lottery_type} ตัว` });

        await pool.request()
            .input('animalName', sql.NVarChar, animal_name_th).input('imageUrl', sql.VarChar(sql.MAX), image_url) 
            .input('lotteryType', sql.VarChar, lottery_type).input('num1', sql.VarChar, num1)
            .input('num2', sql.VarChar, num2).input('num3', sql.VarChar, num3)
            .input('isActive', sql.Bit, is_active ? 1 : 0).input('actionBy', sql.NVarChar, action_by || 'Unknown')
            .query(`INSERT INTO Master_Animal_Numbers (animal_name_th, image_url, lottery_type, num1, num2, num3, is_active, created_by) VALUES (@animalName, @imageUrl, @lotteryType, @num1, @num2, @num3, @isActive, @actionBy)`);
        res.status(201).json({ success: true, message: 'บันทึกข้อมูลสัตว์และตัวเลขสำเร็จ' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการ INSERT Database', error: error.message });
    }
});

app.put('/api/admin/animal-numbers/:id', async (req, res) => {
    const { id } = req.params;
    const { animal_name_th, image_url, lottery_type, num1, num2, num3, is_active, action_by } = req.body;
    try {
        const pool = await sql.connect(dbConfig); 
        const checkQuery = await pool.request().input('lotteryType', sql.VarChar, lottery_type).input('currentId', sql.Int, id).query(`SELECT num1, num2, num3 FROM Master_Animal_Numbers WHERE lottery_type = @lotteryType AND animal_id != @currentId`);
        const existingNumbers = checkQuery.recordset.flatMap(row => [row.num1, row.num2, row.num3]);
        const newNumbers = [num1, num2];
        if (num3 !== '-') newNumbers.push(num3);
        const duplicates = newNumbers.filter(n => existingNumbers.includes(n));
        
        if (duplicates.length > 0) return res.status(400).json({ success: false, message: `เลข ${duplicates.join(', ')} ถูกใช้ไปแล้วในโหมด ${lottery_type} ตัว` });

        await pool.request()
            .input('id', sql.Int, id).input('animalName', sql.NVarChar, animal_name_th).input('imageUrl', sql.VarChar(sql.MAX), image_url) 
            .input('lotteryType', sql.VarChar, lottery_type).input('num1', sql.VarChar, num1)
            .input('num2', sql.VarChar, num2).input('num3', sql.VarChar, num3)
            .input('isActive', sql.Bit, is_active ? 1 : 0).input('actionBy', sql.NVarChar, action_by || 'Unknown')
            .query(`UPDATE Master_Animal_Numbers SET animal_name_th = @animalName, image_url = @imageUrl, lottery_type = @lotteryType, num1 = @num1, num2 = @num2, num3 = @num3, is_active = @isActive, updated_by = @actionBy WHERE animal_id = @id`);
        res.status(200).json({ success: true, message: 'แก้ไขข้อมูลสำเร็จ' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการ UPDATE Database', error: error.message });
    }
});

app.post('/api/lottery/buy', async (req, res) => {
    const { user_id, cart, total_price, currency } = req.body;
    const pool = await sql.connect(dbConfig);
    const transaction = new sql.Transaction(pool);
    try {
        await transaction.begin();
        const request = new sql.Request(transaction);

        let exchangeRate = 1;
        if (currency === 'LAK') {
            const rateRes = await request.query("SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'");
            if (rateRes.recordset.length > 0) exchangeRate = rateRes.recordset[0].rate;
        }

        const baseTHBAmount = total_price / exchangeRate;
        const deductAmount = baseTHBAmount * exchangeRate; 

        const userRes = await request.input('userId', sql.Int, user_id).query('SELECT wallet_balance FROM Users WHERE user_id = @userId'); 
        if (userRes.recordset.length === 0) throw new Error('ไม่พบข้อมูลผู้ใช้ในระบบ');
        if (userRes.recordset[0].wallet_balance < deductAmount) throw new Error('ยอดเงินในกระเป๋าไม่เพียงพอ');

        request.input('deductAmount', sql.Decimal(18,2), deductAmount);
        await request.query(`
            UPDATE Users SET wallet_balance = wallet_balance - @deductAmount WHERE user_id = @userId;
            UPDATE Wallets SET balance = balance - @deductAmount WHERE user_id = @userId;
        `);

        await request
            .input('title', sql.NVarChar, 'ซื้อหวยเวียดนาม')
            .input('amount', sql.Decimal(18,2), -deductAmount) 
            .query(`INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at) VALUES (@userId, 'Buy Lottery', @title, @amount, 'Completed', GETDATE())`);

        const orderRes = await request
            .input('currency', sql.VarChar, currency)
            .input('totalPrice', sql.Decimal(18,2), deductAmount)
            .query(`INSERT INTO Lottery_Orders (user_id, total_amount, currency_code, status, created_at) OUTPUT INSERTED.order_id VALUES (@userId, @totalPrice, @currency, N'รอผลตรวจ', GETDATE())`);
        const orderId = orderRes.recordset[0].order_id;

        for (const item of cart) {
            const itemReq = new sql.Request(transaction);
            await itemReq
                .input('orderId', sql.Int, orderId).input('lotteryNumber', sql.VarChar, item.number)
                .input('lotteryType', sql.VarChar, item.type).input('price', sql.Decimal(18,2), item.price)
                .query(`INSERT INTO Lottery_Order_Items (order_id, lottery_type, selected_number, price, status) VALUES (@orderId, @lotteryType, @lotteryNumber, @price, N'รอผลตรวจ')`);
        }

        await transaction.commit();
        res.status(200).json({ success: true, message: 'ชำระเงินสำเร็จ', order_id: orderId });
    } catch (error) {
        await transaction.rollback();
        res.status(400).json({ success: false, message: error.message || 'เกิดข้อผิดพลาดในการชำระเงิน' });
    }
});

app.get('/api/lottery/prize-rates', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query('SELECT * FROM Lottery_Prize_Rates ORDER BY CAST(lottery_type AS INT) ASC');
        res.status(200).json({ success: true, data: result.recordset });
    } catch (error) {
        res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลอัตราจ่ายได้' });
    }
});

app.get('/api/lottery/history/:userId', async (req, res) => {
    const userId = req.params.userId;
    try {
        const pool = await sql.connect(dbConfig);
        const orderRes = await pool.request().input('userId', sql.Int, userId).query(`
                SELECT order_id, total_amount, currency_code, status, created_at FROM Lottery_Orders WHERE user_id = @userId ORDER BY created_at DESC
            `);
        const orders = orderRes.recordset;
        for (let order of orders) {
            const itemRes = await pool.request().input('orderId', sql.Int, order.order_id).query(`
                    SELECT item_id, lottery_type, selected_number, price, status FROM Lottery_Order_Items WHERE order_id = @orderId
                `);
            order.items = itemRes.recordset;
        }
        res.status(200).json({ success: true, data: orders });
    } catch (error) {
        res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลประวัติได้' });
    }
});

app.listen(port, () => {
    console.log(`🚀 Server เปิดทำงานแล้วที่พอร์ต ${port}`);
});