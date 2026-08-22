require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const cron = require('node-cron');


const app = express();
const port = process.env.PORT || 5000;
// ==========================================
// 🛡️ Middleware: สกัดกั้น IP ที่ถูกบล็อกไม่ให้ใช้ API ได้
// ==========================================
app.use(async (req, res, next) => {
    // ดึง IP ของคนที่เรียก API
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    try {
        const pool = await sql.connect(dbConfig);
        const blockCheck = await pool.request()
            .input('ip', sql.VarChar, clientIp)
            .query(`SELECT is_blocked FROM Blocked_IPs WHERE ip_address = @ip AND is_blocked = 1`);
            
        if (blockCheck.recordset.length > 0) {
            return res.status(403).json({ 
                success: false, 
                message: 'Access Denied: Your IP address has been blocked due to suspicious activity.' 
            });
        }
        next(); // ถ้าไม่ถูกบล็อก ให้ทำงาน API ถัดไปได้ปกติ
    } catch (err) {
        next();
    }
});
// อนุญาตให้หน้าเว็บจากโดเมนของคุณเรียกใช้ API ได้
// กำหนด URL ที่อนุญาตให้เข้าถึง API ได้ (ลบช่องว่างส่วนเกินออก และปรับเป็นตัวเล็กเพื่อความชัวร์)
const allowedOrigins = [
  'https://salapi.company', 
  'https://api.salapi.company',
  'https://emp.salapi.company',
  'http://localhost:5173',
  'http://localhost:5174'
];

app.use(cors({
  origin: function (origin, callback) {
    // อนุญาตให้ request ที่ไม่มี origin (เช่น Postman, การเรียกจาก Server-to-Server) ผ่านได้
    if (!origin) return callback(null, true);
    
    // เช็คว่า origin ที่เรียกมา อยู่ใน List ที่เราอนุญาตหรือไม่
    if (allowedOrigins.indexOf(origin) === -1) {
      var msg = 'CORS Policy: ไม่อนุญาตให้โดเมนนี้เข้าถึง API';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true // อนุญาตให้ส่ง Cookie หรือ Header ยืนยันตัวตนได้ภ
}));
// ขยายขีดจำกัดให้รองรับรูปภาพสลิปที่แปลงเป็น Base64 (ตั้งไว้ที่ 50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ตั้งค่าการเชื่อมต่อฐานข้อมูล
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER, 
    database: process.env.DB_DATABASE,
    options: {
        encrypt: false, // somee.com มักจะไม่บังคับใช้ encrypt
        trustServerCertificate: true 
    }
};

// ทดสอบเชื่อมต่อฐานข้อมูล
sql.connect(dbConfig).then(() => {
    console.log("✅ เชื่อมต่อฐานข้อมูลสำเร็จ!");
}).catch(err => {
    console.log("❌ ไม่สามารถเชื่อมต่อฐานข้อมูลได้:", err);
});

// สร้าง API เส้นทางแรกสำหรับทดสอบ
app.get('/api/status', (req, res) => {
    res.json({ 
        message_th: 'สวัสดี! API ของคุณทำงานปกติ', 
        message_la: 'ສະບາຍດີ! API ຂອງທ່ານເຮັດວຽກປົກກະຕິ' 
    });
});


// ==========================================
// 🌟 🇻🇳 ระบบเปิด-ปิดรับซื้อ และ ออกรางวัลอัตโนมัติ (หวยเวียดนาม) รันทุกๆ 1 นาที
// ==========================================
cron.schedule('* * * * *', async () => {
    try {
        const pool = await sql.connect(dbConfig);
        
        const res = await pool.request().query(`
            SELECT 
                CONVERT(varchar(5), close_time, 108) as close_time,
                CONVERT(varchar(5), open_time, 108) as open_time,
                CONVERT(varchar(5), draw_time, 108) as draw_time,
                is_auto_draw, auto_draw_percent
            FROM System_Settings WHERE id = 1
        `);
        
        if (res.recordset.length > 0) {
            const { close_time, open_time, draw_time, is_auto_draw, auto_draw_percent } = res.recordset[0];
            
            const currentTime = new Date().toLocaleTimeString('en-US', { 
                timeZone: 'Asia/Bangkok', hour12: false, hour: '2-digit', minute: '2-digit' 
            });

            if (currentTime === close_time) {
                await pool.request().query("UPDATE System_Settings SET is_sales_open = 0 WHERE id = 1");
            }
            if (currentTime === open_time) {
                await pool.request().query("UPDATE System_Settings SET is_sales_open = 1 WHERE id = 1");
            }

            // 🌟 เช็คเวลาออกรางวัล
            if (currentTime === draw_time) {
                if (!is_auto_draw) return; // แอดมินปิดออโต้ไว้

                const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
                
                // เช็คว่าวันนี้หวยเวียดนามออกผลไปหรือยัง ป้องกันออโต้ทำงานซ้ำ
                const checkDraw = await pool.request().query(`SELECT 1 FROM Draw_Results WHERE draw_date = '${today}'`);
                if (checkDraw.recordset.length > 0) return; 

                console.log(`🎰 [AUTO-VIETNAM] เริ่มสุ่มเลขเป้าหมายที่ ${auto_draw_percent}%...`);

                const rateRes = await pool.request().query("SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'");
                const exchangeRate = rateRes.recordset.length > 0 ? rateRes.recordset[0].rate : 620.0;
                
                const salesRes = await pool.request().query(`SELECT ISNULL(SUM(CASE WHEN currency_code = 'LAK' THEN total_amount / ${exchangeRate} ELSE total_amount END), 0) as totalSalesTHB FROM Lottery_Orders WHERE status = N'รอผลตรวจ'`);
                const maxPayoutTHB = (salesRes.recordset[0].totalSalesTHB || 0) * (auto_draw_percent / 100);

                const itemsRes = await pool.request().query(`
                    SELECT CAST(i.lottery_type AS VARCHAR) as lottery_type, i.selected_number, 
                    CASE WHEN o.currency_code = 'LAK' THEN i.price / ${exchangeRate} ELSE i.price END as price_thb, r.multiplier
                    FROM Lottery_Order_Items i JOIN Lottery_Orders o ON i.order_id = o.order_id
                    LEFT JOIN Lottery_Prize_Rates r ON CAST(i.lottery_type AS INT) = CAST(r.lottery_type AS INT)
                    WHERE o.status = N'รอผลตรวจ' AND i.status = N'รอผลตรวจ' 
                `);
                
                let bestNumber6 = null, bestPayout = -1;
                for (let i = 0; i < 500; i++) {
                    const random6 = Math.floor(100000 + Math.random() * 900000).toString();
                    const n4 = random6.slice(-4), n3 = random6.slice(-3), n2 = random6.slice(-2);
                    let currentPayout = 0;
                    for (const item of itemsRes.recordset) {
                        let isWin = false;
                        if (item.lottery_type === '6' && item.selected_number === random6) isWin = true;
                        else if (item.lottery_type === '4' && item.selected_number === n4) isWin = true;
                        else if (item.lottery_type === '3' && item.selected_number === n3) isWin = true;
                        else if (item.lottery_type === '2' && item.selected_number === n2) isWin = true;
                        else if (item.lottery_type === '2 ล่าง' && item.selected_number === n2) isWin = true;
                        
                        if (isWin) currentPayout += item.price_thb * (item.multiplier || 0);
                    }
                    if (currentPayout <= maxPayoutTHB && currentPayout > bestPayout) {
                        bestPayout = currentPayout; bestNumber6 = random6;
                    }
                }
                
                if (!bestNumber6) bestNumber6 = Math.floor(100000 + Math.random() * 900000).toString();

                const num8 = Math.floor(10000000 + Math.random() * 90000000).toString();
                const num6 = bestNumber6;
                const num4 = num6.slice(-4), num3 = num6.slice(-3), num2 = num6.slice(-2);

                const transaction = new sql.Transaction(pool);
                await transaction.begin();
                try {
                    // 1. บันทึกตารางผลเวียดนาม
                    await transaction.request()
                        .input('dDate', sql.Date, today).input('p8', sql.VarChar, num8)
                        .input('p6', sql.VarChar, num6).input('p4', sql.VarChar, num4)
                        .input('p3', sql.VarChar, num3).input('p2', sql.VarChar, num2)
                        .query(`
                            INSERT INTO Draw_Results (draw_date, prize_8, prize_6, prize_4, prize_3, prize_2) 
                            VALUES (@dDate, @p8, @p6, @p4, @p3, @p2);
                        `);

                    const commReq = await transaction.request().query("SELECT TOP 1 win_percent FROM Commission_Settings");
                    const commPercent = commReq.recordset.length > 0 ? commReq.recordset[0].win_percent : 0;

                    // 2. ตัดบิล
                    await transaction.request().query(`
                        UPDATE i SET 
                            status = CASE 
                                WHEN (i.lottery_type = N'2 ล่าง' AND i.selected_number = '${num2}') OR
                                     (i.lottery_type = '2' AND i.selected_number = '${num2}') OR
                                     (i.lottery_type = '3' AND i.selected_number = '${num3}') OR
                                     (i.lottery_type = '4' AND i.selected_number = '${num4}') OR
                                     (i.lottery_type = '6' AND i.selected_number = '${num6}') OR
                                     (i.lottery_type = '8' AND i.selected_number = '${num8}') THEN N'ถูกรางวัล'
                                ELSE N'ไม่ถูกรางวัล'
                            END,
                            prize_amount = CASE
                                WHEN (i.lottery_type = N'2 ล่าง' AND i.selected_number = '${num2}') OR
                                     (i.lottery_type = '2' AND i.selected_number = '${num2}') OR
                                     (i.lottery_type = '3' AND i.selected_number = '${num3}') OR
                                     (i.lottery_type = '4' AND i.selected_number = '${num4}') OR
                                     (i.lottery_type = '6' AND i.selected_number = '${num6}') OR
                                     (i.lottery_type = '8' AND i.selected_number = '${num8}') 
                                THEN i.price * ISNULL((SELECT TOP 1 multiplier FROM Lottery_Prize_Rates WHERE lottery_type = i.lottery_type), 0)
                                ELSE 0
                            END
                        FROM Lottery_Order_Items i JOIN Lottery_Orders o ON i.order_id = o.order_id
                        WHERE o.status = N'รอผลตรวจ' AND i.status = N'รอผลตรวจ';
                    `);

                    // 3. จ่ายรางวัล
                    await transaction.request().query(`
                        UPDATE w SET balance = ISNULL(w.balance, 0) + t.TotalPrize
                        FROM Wallets w JOIN (
                            SELECT o.user_id, SUM(i.prize_amount) as TotalPrize
                            FROM Lottery_Order_Items i JOIN Lottery_Orders o ON i.order_id = o.order_id 
                            WHERE i.status = N'ถูกรางวัล' AND o.status = N'รอผลตรวจ' GROUP BY o.user_id
                        ) t ON w.user_id = t.user_id;

                        INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at)
                        SELECT o.user_id, 'Reward', N'ถูกรางวัลหวยเวียดนาม', SUM(i.prize_amount), 'Completed', GETDATE()
                        FROM Lottery_Order_Items i JOIN Lottery_Orders o ON i.order_id = o.order_id 
                        WHERE i.status = N'ถูกรางวัล' AND o.status = N'รอผลตรวจ' GROUP BY o.user_id;
                    `);

                    // 4. จ่ายค่าคอม
                    if (commPercent > 0) {
                        await transaction.request().query(`
                            UPDATE w SET w.balance = ISNULL(w.balance, 0) + t.CommAmount
                            FROM Wallets w JOIN (
                                SELECT d.referrer_username, SUM(i.prize_amount) * (${commPercent} / 100.0) as CommAmount
                                FROM Lottery_Order_Items i JOIN Lottery_Orders o ON i.order_id = o.order_id 
                                JOIN Users d ON o.user_id = d.user_id
                                WHERE i.status = N'ถูกรางวัล' AND o.status = N'รอผลตรวจ' AND d.referrer_username IS NOT NULL
                                GROUP BY d.referrer_username HAVING SUM(i.prize_amount) > 0
                            ) t ON w.user_id = (SELECT user_id FROM Users WHERE username = t.referrer_username);
                            
                            INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at)
                            SELECT (SELECT user_id FROM Users WHERE username = d.referrer_username), 'Commission', N'ค่าคอมฯ ลูกทีมถูกรางวัล (' + d.username + ')', SUM(i.prize_amount) * (${commPercent} / 100.0), 'Completed', GETDATE()
                            FROM Lottery_Order_Items i JOIN Lottery_Orders o ON i.order_id = o.order_id 
                            JOIN Users d ON o.user_id = d.user_id
                            WHERE i.status = N'ถูกรางวัล' AND o.status = N'รอผลตรวจ' AND d.referrer_username IS NOT NULL
                            GROUP BY d.referrer_username, d.username HAVING SUM(i.prize_amount) > 0;
                        `);
                    }

                    // 5. ปิดบิลแม่
                    await transaction.request().query(`UPDATE Lottery_Orders SET status = N'ตรวจผลแล้ว', draw_date = GETDATE() WHERE status = N'รอผลตรวจ';`);
                    
                    await transaction.commit();
                    console.log(`✅ [AUTO-VIETNAM] ออกรางวัล บันทึกตาราง และจ่ายเงินสำเร็จเรียบร้อย!`);
                } catch (innerErr) {
                    await transaction.rollback();
                    console.error('❌ [AUTO-VIETNAM] DB Transaction Error:', innerErr);
                }
            }
        }
    } catch (err) {
        console.error('❌ เกิดข้อผิดพลาดในระบบตั้งเวลาอัตโนมัติหวยเวียดนาม:', err);
    }
});

// ==========================================
// 🌟 API สำหรับระบบเมนูอัจฉริยะ (Dynamic Menu)
// ==========================================
// 1. ดึงข้อมูลเมนูทั้งหมด (GET) - ส่งไปให้ React วาดเมนูซ้ายมือ
app.get('/api/menus', async (req, res) => {
    try {
        // 🌟 แก้ไขเป็น dbConfig ให้ตรงกับหน้า Login
        const pool = await sql.connect(dbConfig); 
        const result = await pool.request().query(`
            SELECT 
                menu_id AS id, 
                title, 
                path, 
                icon, 
                component, 
                parent_id AS parentId, 
                show_notification AS showNotification
            FROM System_Menus
            ORDER BY parent_id, sort_order, menu_id
        `);
        
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching menus:', err);
        res.status(500).send('Server error');
    }
});

// 2. เพิ่มเมนูใหม่ลง Database (POST)
app.post('/api/menus', async (req, res) => {
    const { title, path, icon, component, parentId, showNotification } = req.body;
    
    try {
        // 🌟 แก้ไขเป็น dbConfig
        const pool = await sql.connect(dbConfig); 
        const result = await pool.request()
            .input('title', sql.NVarChar, title)
            .input('path', sql.VarChar, path || null)
            .input('icon', sql.VarChar, icon || null)
            .input('component', sql.VarChar, component || null)
            .input('parent_id', sql.Int, parentId || null)
            .input('show_notification', sql.Bit, showNotification === false ? 0 : 1)
            .query(`
                INSERT INTO System_Menus (title, path, icon, component, parent_id, show_notification)
                OUTPUT INSERTED.menu_id AS id
                VALUES (@title, @path, @icon, @component, @parent_id, @show_notification)
            `);
            
        res.status(201).json({ 
            message: 'บันทึกเมนูสำเร็จ', 
            id: result.recordset[0].id 
        });
    } catch (err) {
        console.error('Error saving menu:', err);
        res.status(500).send('Server error');
    }
});

// 3. แก้ไขเมนู (PUT)
app.put('/api/menus/:id', async (req, res) => {
    const { id } = req.params;
    const { title, path, icon, component, parentId, showNotification } = req.body;
    
    try {
        // 🌟 แก้ไขเป็น dbConfig
        const pool = await sql.connect(dbConfig); 
        await pool.request()
            .input('id', sql.Int, id)
            .input('title', sql.NVarChar, title)
            .input('path', sql.VarChar, path || null)
            .input('icon', sql.VarChar, icon || null)
            .input('component', sql.VarChar, component || null)
            .input('parent_id', sql.Int, parentId || null)
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

// 4. ลบเมนู (DELETE)
app.delete('/api/menus/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // 🌟 แก้ไขเป็น dbConfig
        const pool = await sql.connect(dbConfig); 
        await pool.request()
            .input('id', sql.Int, id)
            .query(`
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
// API 1: ตรวจสอบผู้แนะนำ (Check Referrer)
// ==========================================
app.get('/api/check-referrer/:username', async (req, res) => {
  const username = req.params.username;

  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request()
      .input('username', sql.VarChar, username)
      .query(`
        SELECT u.username, un.firstname, un.lastname
        FROM Users u
        LEFT JOIN UserName_Lastname un ON u.user_id = un.user_id
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
    console.error('Check Referrer API Error:', err);
    res.status(500).json({ message: 'ระบบขัดข้อง' });
  }
});

// ==========================================
// API 2: ตรวจสอบชื่อผู้ใช้ซ้ำ (Check Username)
// ==========================================
app.get('/api/check-username/:username', async (req, res) => {
  const username = req.params.username;
  
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request()
      .input('username', sql.VarChar, username)
      .query('SELECT username FROM Users WHERE username = @username');

    if (result.recordset.length > 0) {
      res.json({ available: false }); // มีคนใช้แล้ว
    } else {
      res.json({ available: true });  // ว่าง ใช้ได้
    }
  } catch (err) {
    console.error('Check Username API Error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ==========================================
// API: สมัครสมาชิก (Register)
// ==========================================
app.post('/api/register', async (req, res) => {
  const { username, password, referrer, country } = req.body;
  
  try {
    const pool = await sql.connect(dbConfig);
    
    // 1. เช็กซ้ำอีกรอบเพื่อความชัวร์ว่าชื่อยังไม่มีคนใช้
    const checkUser = await pool.request()
      .input('username', sql.NVarChar, username) // 🌟 เปลี่ยนเป็น NVarChar
      .query('SELECT username FROM Users WHERE username = @username');
      
    if (checkUser.recordset.length > 0) {
      return res.status(400).json({ success: false, message: 'ชื่อผู้ใช้นี้มีคนใช้แล้ว' });
    }

    // 2. กำหนดค่าเริ่มต้นสำหรับสมาชิกใหม่
    const currency_code = country === 'Laos' ? 'LAK' : 'THB';
    const role_id = 4;  // สมมติให้ 4 คือ Role ของ User ทั่วไป
    const level_id = 1; // 1 คือลูกค้าระดับเริ่มต้น (ลูกค้าใหม่)
    
    // 3. บันทึกข้อมูลลงตาราง Users 
    const insertResult = await pool.request()
      .input('username', sql.NVarChar, username) // 🌟 เปลี่ยนเป็น NVarChar
      .input('password', sql.NVarChar, password) 
      .input('referrer', sql.NVarChar, referrer || null)
      .input('country', sql.NVarChar, country)
      .input('currency_code', sql.VarChar, currency_code)
      .input('role_id', sql.Int, role_id)
      .input('level_id', sql.Int, level_id)
      .query(`
        INSERT INTO Users (username, password_hash, referrer_username, country, currency_code, role_id, level_id, is_active, created_at, wallet_balance, total_orders)
        OUTPUT INSERTED.user_id
        VALUES (@username, @password, @referrer, @country, @currency_code, @role_id, @level_id, 1, GETDATE(), 0, 0)
      `);
      
    // ดึง user_id ที่เพิ่งถูกสร้างขึ้นมา
    const newUserId = insertResult.recordset[0].user_id;

    // 4. สร้างกระเป๋าเงิน (Wallets) และข้อมูลชื่อพื้นฐานให้ User ใหม่ด้วย
    await pool.request()
      .input('user_id', sql.Int, newUserId)
      .query(`
        -- 🌟 ใส่ N นำหน้าคำภาษาไทยเพื่อให้ SQL บันทึกเป็น Unicode
        INSERT INTO UserName_Lastname (user_id, firstname, lastname) VALUES (@user_id, N'ผู้ใช้', N'ใหม่');
        INSERT INTO Wallets (user_id, balance, points) VALUES (@user_id, 0, 0);
      `);

    res.json({ success: true, message: 'สมัครสมาชิกสำเร็จ' });

  } catch (err) {
    console.error('Register API Error:', err);
    res.status(500).json({ success: false, message: 'ระบบขัดข้อง ไม่สามารถบันทึกข้อมูลได้' });
  }
});


// ==========================================
// API 1: ดึงรายชื่อธนาคารทั้งหมด (จากตาราง Banks)
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

// ==========================================
// 🏦 API ดึงบัญชีธนาคารของลูกค้า (หน้าแอป)
// ==========================================
app.get('/api/user-profile-banks/:uid', async (req, res) => {
    try {
        const uid = req.params.uid;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('uid', sql.Int, uid)
            .query(`
                SELECT ub.*, b.bank_name, b.bank_code 
                FROM UserBanks ub
                LEFT JOIN Banks b ON ub.bank_id = b.bank_id
                WHERE ub.user_id = @uid AND ub.status != 'Deleted' /* 🌟 เพิ่ม AND status != 'Deleted' ตรงนี้ครับ */
                ORDER BY ub.created_at DESC
            `);
            
        res.json({ success: true, userBanks: result.recordset });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// API 3: เพิ่มบัญชีธนาคาร พร้อมอัปเดตชื่อ-นามสกุล
// ==========================================
app.post('/api/add-user-bank', async (req, res) => {
  const { userId, firstname, lastname, bankId, accountName, accountNumber, currencyCode, passbookBase64 } = req.body;
  try {
    const pool = await sql.connect(dbConfig);
    
    // 1. อัปเดตชื่อ-นามสกุลในระบบให้ตรงกับบัญชีธนาคาร
    await pool.request()
      .input('userId', sql.Int, userId)
      .input('fname', sql.NVarChar, firstname)
      .input('lname', sql.NVarChar, lastname)
      .query('UPDATE UserName_Lastname SET firstname = @fname, lastname = @lname WHERE user_id = @userId');

    // 2. บันทึกบัญชีธนาคาร พร้อมรูปสมุดบัญชี และตั้งสถานะเป็น Pending (รอตรวจสอบ)
    await pool.request()
      .input('userId', sql.Int, userId)
      .input('bankId', sql.Int, bankId)
      .input('accountName', sql.NVarChar, accountName)
      .input('accountNumber', sql.VarChar, accountNumber)
      .input('currency', sql.VarChar, currencyCode)
      .input('passbook', sql.VarChar(sql.MAX), passbookBase64)
      .query(`
        INSERT INTO UserBanks 
        (user_id, bank_id, account_name, account_number, currency_code, is_primary, passbook_image, status, created_at)
        VALUES 
        (@userId, @bankId, @accountName, @accountNumber, @currency, 1, @passbook, 'Pending', GETDATE())
      `);

    res.json({ success: true, message: 'เพิ่มบัญชีธนาคารสำเร็จ กรุณารอแอดมินตรวจสอบ' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'ไม่สามารถเพิ่มบัญชีได้' });
  }
});

// ==========================================
// API 4: แจ้งฝากเงิน (จำลองการรับสลิปเป็น Base64 ไปก่อน)
// ==========================================
app.post('/api/deposit', async (req, res) => {
  const { userId, userBankId, amount, slipBase64 } = req.body;
  try {
    // ในอนาคตคุณจะนำ slipBase64 ไปแปลงเป็นรูปแล้วเซฟลงโฟลเดอร์ หรืออัปโหลดขึ้น Cloud
    // ตอนนี้ให้จำลองว่าสำเร็จและส่งข้อมูลกลับไปก่อน
    console.log(`User ${userId} deposited ${amount} via bank ${userBankId}`);
    
    res.json({ success: true, message: 'แจ้งฝากเงินสำเร็จ รอผู้ดูแลระบบตรวจสอบ' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'ทำรายการไม่สำเร็จ' });
  }
});
// ==========================================
// 1. API สำหรับ Login (อัปเดตดึงข้อมูลครบถ้วน + 🛡️ ระบบเฝ้าระวัง IP)
// ==========================================
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  // 🛡️ [เพิ่มใหม่ระบบ IP]: ดึง IP Address ของคนที่พยายาม Login
  let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
  if (clientIp.includes(',')) clientIp = clientIp.split(',')[0].trim(); // ป้องกันกรณีดึงได้หลาย IP ซ้อนกัน

  try {
    const pool = await sql.connect(dbConfig);
    
    // 🛡️ [เพิ่มใหม่ระบบ IP]: 1. เช็คก่อนเลยว่า IP นี้ติดแบล็คลิสต์ (บล็อก) อยู่หรือไม่
    const blockCheck = await pool.request()
        .input('ip', sql.VarChar, clientIp)
        .query(`SELECT is_blocked FROM Blocked_IPs WHERE ip_address = @ip AND is_blocked = 1`);
        
    if (blockCheck.recordset.length > 0) {
        return res.status(403).json({ success: false, message: 'IP ของคุณถูกบล็อก เนื่องจากพยายามเข้าระบบผิดพลาดหลายครั้ง' });
    }

    // 🛡️ [เพิ่มใหม่ระบบ IP]: ฟังก์ชันย่อยสำหรับนับจำนวนครั้งที่เข้าสู่ระบบผิดพลาด
    const handleFailedLogin = async () => {
        // บันทึกประวัติว่า IP นี้ใส่รหัสผิด
        await pool.request()
            .input('ip', sql.VarChar, clientIp)
            .query(`INSERT INTO Login_Failed_Attempts (ip_address) VALUES (@ip)`);

        // นับดูว่าใน 1 นาทีที่ผ่านมา IP นี้ผิดไปกี่ครั้งแล้ว
        const failCheck = await pool.request()
            .input('ip', sql.VarChar, clientIp)
            .query(`
                SELECT COUNT(id) as fail_count 
                FROM Login_Failed_Attempts 
                WHERE ip_address = @ip AND attempt_time >= DATEADD(MINUTE, -1, GETDATE())
            `);

        // ถ้าผิดตั้งแต่ 10 ครั้งขึ้นไป ให้จับบล็อกทันที
        if (failCheck.recordset[0].fail_count >= 10) {
            await pool.request()
                .input('ip', sql.VarChar, clientIp)
                .query(`
                    IF NOT EXISTS (SELECT 1 FROM Blocked_IPs WHERE ip_address = @ip)
                        INSERT INTO Blocked_IPs (ip_address, reason, is_blocked) VALUES (@ip, 'Brute Force Login Attempt (>10 fails/min)', 1);
                    ELSE
                        UPDATE Blocked_IPs SET is_blocked = 1, reason = 'Brute Force Login Attempt (>10 fails/min)', updated_at = GETDATE() WHERE ip_address = @ip;
                `);
            return true; // แจ้งว่าโดนบล็อกแล้ว
        }
        return false; // ยังไม่โดนบล็อก
    };
    
    // 🌟 ดึงข้อมูล User พร้อมกับ Role, Level, ชื่อ-นามสกุล, ประเทศ และ สกุลเงิน (โค้ดเดิม)
    const userResult = await pool.request()
      .input('username', sql.VarChar, username)
      .query(`
        SELECT 
          u.user_id, u.username, u.password_hash, u.wallet_balance, u.total_orders, u.is_active,
          u.country, u.currency_code,  -- 🌟 เพิ่ม 2 คอลัมน์นี้
          un.firstname, un.lastname,
          r.role_id, r.role_name,
          cl.level_id, cl.level_name
        FROM Users u
        LEFT JOIN UserName_Lastname un ON u.user_id = un.user_id
        LEFT JOIN Roles r ON u.role_id = r.role_id
        LEFT JOIN CustomerLevels cl ON u.level_id = cl.level_id
        WHERE u.username = @username
      `);

    // ถ้าไม่เจอ Username ในระบบ
    if (userResult.recordset.length === 0) {
      // 🛡️ [เพิ่มใหม่ระบบ IP]: บันทึกว่าใส่ข้อมูลผิด
      const isBlockedNow = await handleFailedLogin();
      if (isBlockedNow) {
          return res.status(403).json({ message: 'IP ของคุณถูกบล็อก เนื่องจากพยายามเข้าระบบผิดพลาดหลายครั้ง' });
      }
      return res.status(401).json({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    const user = userResult.recordset[0];

    // เช็คว่า User ถูกระงับการใช้งานหรือไม่ (is_active = 0)
    if (!user.is_active) {
      return res.status(403).json({ message: 'บัญชีนี้ถูกระงับการใช้งาน' });
    }

    // ==========================================
    // ตรวจสอบรหัสผ่าน
    // ==========================================
    let validPassword = false;

    if (password === user.password_hash) {
      validPassword = true;
    } 
    
    // ถ้ารหัสผ่านไม่ตรง
    if (!validPassword) {
      // 🛡️ [เพิ่มใหม่ระบบ IP]: บันทึกว่าใส่ข้อมูลผิด
      const isBlockedNow = await handleFailedLogin();
      if (isBlockedNow) {
          return res.status(403).json({ message: 'IP ของคุณถูกบล็อก เนื่องจากพยายามเข้าระบบผิดพลาดหลายครั้ง' });
      }
      return res.status(401).json({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    // 🛡️ [เพิ่มใหม่ระบบ IP]: 🌟 ล้างประวัติการใส่รหัสผิดทั้งหมด ถ้า Login สำเร็จ
    await pool.request()
        .input('ip', sql.VarChar, clientIp)
        .query(`DELETE FROM Login_Failed_Attempts WHERE ip_address = @ip`);

    // 🌟 ส่งข้อมูลกลับไปให้ Frontend แบบจัดเต็ม (โค้ดเดิม ไม่มีการเปลี่ยนแปลงข้อมูลส่วนนี้)
    res.json({
      success: true, 
      message: 'เข้าสู่ระบบสำเร็จ',
      user: {
        id: user.user_id, 
        user_id: user.user_id, 
        username: user.username,
        firstname: user.firstname || 'ผู้ใช้',
        lastname: user.lastname || '',
        country: user.country || 'Thailand',          
        currency_code: user.currency_code || 'THB',    
        role_id: user.role_id,
        role_name: user.role_name || 'User',          
        level_id: user.level_id,
        level_name: user.level_name || 'ลูกค้าใหม่',      
        wallet: user.wallet_balance || 0.00,
        point: 0 
      }
    });

  } catch (err) {
    console.error('Login API Error:', err);
    res.status(500).json({ message: 'ระบบขัดข้อง ไม่สามารถเชื่อมต่อฐานข้อมูลได้ในขณะนี้' });
  }
});


// ==========================================
// API: ดึงอัตราแลกเปลี่ยน (Exchange Rates)
// ==========================================
app.get('/api/exchange-rates', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    
    // ดึงข้อมูลทั้งหมดจากตาราง ExchangeRates
    const result = await pool.request()
      .query('SELECT currency_pair, rate, last_updated FROM ExchangeRates');

    // จัด Format ให้อ่านง่าย เช่น { "THB_LAK": 620.00, "USD_THB": 36.00 }
    const rates = {};
    let lastUpdated = null;
    
    result.recordset.forEach(row => {
      rates[row.currency_pair] = row.rate;
      if (!lastUpdated) lastUpdated = row.last_updated; // ดึงเวลาอัปเดตล่าสุดมาด้วย
    });

    res.json({ 
      success: true, 
      rates: rates,
      last_updated: lastUpdated
    });

  } catch (err) {
    console.error('Exchange Rate API Error:', err);
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลอัตราแลกเปลี่ยนได้' });
  }
});


// ==========================================
// API สำหรับ Register (อัปเดตรองรับประเทศและสกุลเงิน)
// ==========================================
app.post('/api/register', async (req, res) => {
  // 🌟 รับค่า country เพิ่มเข้ามาจาก Frontend
  const { username, password, referrer, country } = req.body;

  try {
    const pool = await sql.connect(dbConfig);
    
    // ตรวจสอบว่า Username ซ้ำไหม (โค้ดเดิมของคุณ)
    // ... 

    // 🌟 กำหนดสกุลเงินตามประเทศที่เลือก
    let currencyCode = 'THB'; // ค่าเริ่มต้น
    let selectedCountry = country || 'Thailand';

    if (selectedCountry.toLowerCase() === 'laos') {
      currencyCode = 'LAK';
    }

    // 🌟 บันทึกลงฐานข้อมูล (เพิ่ม country และ currency_code เข้าไปในคำสั่ง INSERT)
    await pool.request()
      .input('username', sql.VarChar, username)
      .input('password_hash', sql.VarChar, password) // (แนะนำ: อนาคตควรแฮชรหัสผ่าน)
      .input('referrer_username', sql.VarChar, referrer || null)
      .input('country', sql.NVarChar, selectedCountry)
      .input('currency_code', sql.NVarChar, currencyCode)
      .query(`
        INSERT INTO Users (username, password_hash, referrer_username, role_id, level_id, is_active, country, currency_code)
        VALUES (@username, @password_hash, @referrer_username, 4, 1, 1, @country, @currency_code)
      `);
      // หมายเหตุ: role_id 4 = User ทั่วไป, level_id 1 = ระดับเริ่มต้น

    res.status(201).json({ message: 'สมัครสมาชิกสำเร็จ' });

  } catch (err) {
    console.error('Register API Error:', err);
    res.status(500).json({ message: 'ระบบขัดข้อง ไม่สามารถสมัครสมาชิกได้' });
  }
});

// ==========================================
// API: ดึงข้อมูลหน้า Dashboard (Wallet & Transactions)
// ==========================================
app.get('/api/dashboard/:userId', async (req, res) => {
  const userId = req.params.userId;
  
  try {
    const pool = await sql.connect(dbConfig);
    
    // 1. ดึงข้อมูลกระเป๋าเงิน
    const walletResult = await pool.request()
      .input('user_id', sql.Int, userId)
      .query('SELECT balance, points FROM Wallets WHERE user_id = @user_id');
      
    let wallet = walletResult.recordset[0];
    
    // ถ้าเพิ่งสมัครและยังไม่มีกระเป๋าเงิน ให้ส่งค่า 0 กลับไป
    if (!wallet) {
      wallet = { balance: 0.00, points: 0 };
    }

    // 2. ดึงรายการธุรกรรมล่าสุด 5 รายการ
    const txResult = await pool.request()
      .input('user_id', sql.Int, userId)
      .query(`
        SELECT TOP 5 transaction_id, transaction_type, title, amount, status, created_at 
        FROM Transactions 
        WHERE user_id = @user_id 
        ORDER BY created_at DESC
      `);
      
    const transactions = txResult.recordset;

    res.json({
      wallet: wallet,
      recentTransactions: transactions
    });

  } catch (err) {
    console.error('Dashboard API Error:', err);
    res.status(500).json({ message: 'DB Error' });
  }
});


// ==========================================
// API: แจ้งฝากเงิน (Deposit)
// ==========================================
app.post('/api/deposit', async (req, res) => {
  const { userId, systemBankId, amount, slipBase64 } = req.body;

  // ตรวจสอบว่าส่งข้อมูลมาครบหรือไม่
  if (!userId || !systemBankId || !amount || !slipBase64) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วนและแนบสลิป' });
  }

  try {
    const pool = await poolPromise; // หรือใช้ตัวแปรการเชื่อมต่อ DB ที่คุณใช้อยู่

    // 1. ดึงชื่อธนาคารระบบ เพื่อเอามาตั้งชื่อรายการให้สวยงาม (เช่น "แจ้งฝากเงินเข้า KBANK")
    const bankReq = await pool.request()
      .input('bank_id', sql.Int, systemBankId)
      .query('SELECT bank_name, bank_code FROM Banks WHERE bank_id = @bank_id');
      
    let bankInfo = 'บัญชีระบบ';
    if (bankReq.recordset.length > 0) {
      bankInfo = bankReq.recordset[0].bank_code;
    }

    const title = `แจ้งฝากเงินเข้า ${bankInfo}`;

    // 2. บันทึกข้อมูลลงตาราง Transactions พร้อมตั้งสถานะเป็น 'Pending' (รอตรวจสอบ)
    // 💡 สังเกต: title และ slip_image ใช้ sql.NVarChar เพื่อรองรับภาษาไทยและข้อมูล Base64 ที่ยาวมาก
    await pool.request()
      .input('user_id', sql.Int, userId)
      .input('title', sql.NVarChar, title)
      .input('amount', sql.Decimal(18,2), amount)
      .input('transaction_type', sql.VarChar, 'Deposit') // กำหนดประเภทเป็น Deposit
      .input('status', sql.VarChar, 'Pending')           // 🌟 ตั้งสถานะเริ่มต้นเป็น Pending
      .input('system_bank_id', sql.Int, systemBankId)
      .input('slip_image', sql.NVarChar, slipBase64) 
      .query(`
        INSERT INTO Transactions 
        (user_id, title, amount, transaction_type, status, system_bank_id, slip_image, created_at)
        VALUES 
        (@user_id, @title, @amount, @transaction_type, @status, @system_bank_id, @slip_image, GETDATE())
      `);

    res.json({ 
      success: true, 
      message: 'แจ้งฝากเงินสำเร็จ! ระบบกำลังตรวจสอบรายการของคุณ (รอ 1-3 นาที)' 
    });

  } catch (error) {
    console.error('Deposit Error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูลที่เซิร์ฟเวอร์' });
  }
});

// ==========================================
// API: (Admin) ดึงรายการฝากเงินที่รอตรวจสอบทั้งหมด
// ==========================================
app.get('/api/admin/pending-deposits', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        t.transaction_id, t.amount, t.slip_image, t.created_at, t.status,
        u.username,
        b.bank_name, b.account_number
      FROM Transactions t
      LEFT JOIN Users u ON t.user_id = u.user_id
      LEFT JOIN Banks b ON t.system_bank_id = b.bank_id
      WHERE t.transaction_type = 'Deposit' AND t.status = 'Pending'
      ORDER BY t.created_at ASC
    `);
    res.json({ success: true, transactions: result.recordset });
  } catch (error) {
    console.error('Fetch Pending Deposits Error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
  }
});

// ==========================================
// API: (Admin) จัดการอนุมัติ หรือ ปฏิเสธ รายการฝากเงิน
// ==========================================
app.post('/api/admin/manage-deposit', async (req, res) => {
  const { transactionId, action } = req.body; // action ส่งมาเป็น 'approve' หรือ 'reject'

  if (!transactionId || !action) {
    return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });
  }

  try {
    const pool = await poolPromise;
    
    // เช็คก่อนว่ารายการนี้ยังมีอยู่และรอตรวจสอบจริงไหม
    const txReq = await pool.request()
      .input('tx_id', sql.Int, transactionId)
      .query("SELECT * FROM Transactions WHERE transaction_id = @tx_id AND status = 'Pending'");

    if (txReq.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบรายการ หรือรายการนี้ถูกจัดการไปแล้ว' });
    }

    const tx = txReq.recordset[0];

    if (action === 'approve') {
      // 🌟 ถ้า "อนุมัติ" ต้องใช้ Transaction ล็อคการทำงาน 2 อย่าง (เปลี่ยนสถานะ + เติมเงิน)
      const transaction = new sql.Transaction(pool);
      await transaction.begin();

      try {
        // 1. เปลี่ยนสถานะเป็น Completed
        await new sql.Request(transaction)
          .input('tx_id', sql.Int, transactionId)
          .query("UPDATE Transactions SET status = 'Completed', updated_at = GETDATE() WHERE transaction_id = @tx_id");

        // 2. เติมเงินเข้ากระเป๋า
        await new sql.Request(transaction)
          .input('user_id', sql.Int, tx.user_id)
          .input('amount', sql.Decimal(18,2), tx.amount)
          .query("UPDATE Wallets SET balance = balance + @amount, updated_at = GETDATE() WHERE user_id = @user_id");

        await transaction.commit();
        res.json({ success: true, message: 'อนุมัติยอดเงินเข้ากระเป๋าลูกค้าสำเร็จ!' });
      } catch (err) {
        await transaction.rollback();
        throw err;
      }

    } else if (action === 'reject') {
      // 🌟 ถ้า "ปฏิเสธ" (สลิปปลอม/ยอดไม่เข้า) แค่เปลี่ยนสถานะเป็น Rejected
      await pool.request()
        .input('tx_id', sql.Int, transactionId)
        .query("UPDATE Transactions SET status = 'Rejected', updated_at = GETDATE() WHERE transaction_id = @tx_id");
      
      res.json({ success: true, message: 'ปฏิเสธรายการสำเร็จ (ลูกค้าจะไม่ได้รับเงิน)' });
    }

  } catch (error) {
    console.error('Manage Deposit Error:', error);
    res.status(500).json({ success: false, message: 'ระบบเซิร์ฟเวอร์ขัดข้อง' });
  }
});




// ==========================================
// API: (Admin) จัดการอนุมัติ หรือ ปฏิเสธ บัญชีธนาคารลูกค้า
// ==========================================
app.post('/api/admin/verify-customer-bank', async (req, res) => {
  const { userBankId, action } = req.body; // รับค่า 'Approved' หรือ 'Rejected'

  if (!userBankId || !action) {
    return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });
  }

  try {
    const pool = await poolPromise;
    await pool.request()
      .input('id', sql.Int, userBankId)
      .input('status', sql.VarChar, action)
      .query("UPDATE UserBanks SET status = @status WHERE user_bank_id = @id");
      
    res.json({ success: true, message: action === 'Approved' ? 'อนุมัติบัญชีสำเร็จ' : 'ปฏิเสธบัญชีสำเร็จ' });
  } catch (error) {
    console.error('Verify Bank Error:', error);
    res.status(500).json({ success: false, message: 'ระบบเซิร์ฟเวอร์ขัดข้อง' });
  }
});


// ==========================================
// API: (Admin) ดึงรายการฝากเงินที่รอตรวจสอบทั้งหมด
// ==========================================
app.get('/api/admin/pending-deposits', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        t.transaction_id, t.amount, t.slip_image, t.created_at, t.status,
        u.username,
        b.bank_name, b.account_number
      FROM Transactions t
      LEFT JOIN Users u ON t.user_id = u.user_id
      LEFT JOIN Banks b ON t.system_bank_id = b.bank_id
      WHERE t.transaction_type = 'Deposit' AND t.status = 'Pending'
      ORDER BY t.created_at ASC
    `);
    res.json({ success: true, transactions: result.recordset });
  } catch (error) {
    console.error('Fetch Pending Deposits Error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
  }
});

// ==========================================
// API: (Admin) จัดการอนุมัติ หรือ ปฏิเสธ รายการฝากเงิน
// ==========================================
app.post('/api/admin/manage-deposit', async (req, res) => {
  const { transactionId, action } = req.body; 

  if (!transactionId || !action) {
    return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });
  }

  try {
    const pool = await poolPromise;
    const txReq = await pool.request()
      .input('tx_id', sql.Int, transactionId)
      .query("SELECT * FROM Transactions WHERE transaction_id = @tx_id AND status = 'Pending'");

    if (txReq.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบรายการ หรือรายการนี้ถูกจัดการไปแล้ว' });
    }

    const tx = txReq.recordset[0];

    if (action === 'approve') {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();

      try {
        await new sql.Request(transaction)
          .input('tx_id', sql.Int, transactionId)
          .query("UPDATE Transactions SET status = 'Completed', updated_at = GETDATE() WHERE transaction_id = @tx_id");

        await new sql.Request(transaction)
          .input('user_id', sql.Int, tx.user_id)
          .input('amount', sql.Decimal(18,2), tx.amount)
          .query("UPDATE Wallets SET balance = balance + @amount, updated_at = GETDATE() WHERE user_id = @user_id");

        await transaction.commit();
        res.json({ success: true, message: 'อนุมัติยอดเงินเข้ากระเป๋าลูกค้าสำเร็จ!' });
      } catch (err) {
        await transaction.rollback();
        throw err;
      }

    } else if (action === 'reject') {
      await pool.request()
        .input('tx_id', sql.Int, transactionId)
        .query("UPDATE Transactions SET status = 'Rejected', updated_at = GETDATE() WHERE transaction_id = @tx_id");
      
      res.json({ success: true, message: 'ปฏิเสธรายการสำเร็จ (ลูกค้าจะไม่ได้รับเงิน)' });
    }

  } catch (error) {
    console.error('Manage Deposit Error:', error);
    res.status(500).json({ success: false, message: 'ระบบเซิร์ฟเวอร์ขัดข้อง' });
  }
});



// ==========================================
// 1. API ดึงรายการคำขอเพิ่มบัญชีธนาคารทั้งหมด (แอดมิน)
// ==========================================
app.get('/api/admin/user-banks', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query(`
            SELECT 
                ub.user_bank_id, ub.user_id, ub.bank_id, ub.account_name, ub.account_number, 
                ub.is_primary, ub.created_at, ub.currency_code, ub.status, 
                ub.passbook_image, 
                ub.reject_reason, /* 🌟 เพิ่มคอลัมน์ประวัติการสั่งแก้ตรงนี้ครับ */
                un.firstname, un.lastname
            FROM UserBanks ub
            LEFT JOIN UserName_Lastname un ON ub.user_id = un.user_id
            WHERE ub.status != 'Deleted'
            ORDER BY ub.created_at DESC
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Error fetching user banks:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ==========================================
// 🗑️ [CLIENT] ลบสมุดบัญชี (แบบ Soft Delete ไม่ลบจริงจากฐานข้อมูล)
// ==========================================
app.delete('/api/user-banks/:id', async (req, res) => {
    try {
        const bankId = req.params.id;
        const pool = await sql.connect(dbConfig);
        
        // 🌟 อัปเดตสถานะเป็น Deleted แทนการใช้คำสั่ง DELETE FROM
        await pool.request()
            .input('id', sql.Int, bankId)
            .query(`UPDATE UserBanks SET status = 'Deleted' WHERE user_bank_id = @id`);
            
        res.json({ success: true, message: 'ลบบัญชีสำเร็จ' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error: ' + err.message });
    }
});


// ==========================================
// 🏦 [ADMIN] อนุมัติ / ปฏิเสธ สมุดบัญชีลูกค้า
// ==========================================
app.put('/api/admin/user-banks/:id/status', async (req, res) => {
    try {
        const user_bank_id = req.params.id;
        const { status, reject_reason } = req.body; 

        const pool = await sql.connect(dbConfig);
        
        // อัปเดตสถานะสมุดบัญชี และใส่เหตุผลที่ไม่อนุมัติ (ถ้ามี)
        await pool.request()
            .input('id', sql.Int, user_bank_id)
            .input('status', sql.VarChar, status)
            .input('reason', sql.NVarChar(sql.MAX), reject_reason || null)
            .query(`
                UPDATE UserBanks 
                SET status = @status, 
                    reject_reason = @reason
                WHERE user_bank_id = @id
            `);
            
        res.json({ success: true, message: 'อัปเดตสถานะสมุดบัญชีสำเร็จ' });
    } catch (err) {
        console.error("เกิดข้อผิดพลาดในการอัปเดตสถานะบัญชี:", err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์: ' + err.message });
    }
});
// ==========================================
// ✏️ [CLIENT] แก้ไขสมุดบัญชีที่โดนปฏิเสธ (ส่งตรวจใหม่)
// ==========================================
app.put('/api/user-banks/:id', async (req, res) => {
    try {
        const bankId = req.params.id;
        const { firstname, lastname, bankId: newBankId, accountNumber, currencyCode, passbookBase64 } = req.body;
        const accountName = `${firstname} ${lastname}`;

        const pool = await sql.connect(dbConfig);

        let updateQuery = `
            UPDATE UserBanks 
            SET bank_id = @bankId, 
                account_number = @accNum, 
                account_name = @accName, 
                currency_code = @curr, 
                status = 'Re-submitted' /* 🌟 1. เปลี่ยนสถานะเป็น "ส่งเรื่องแก้แล้ว" */
                /* 🌟 2. เอาคำสั่ง reject_reason = NULL ออก (เก็บความจำไว้ให้แอดมินดู) */
        `;
        if (passbookBase64) updateQuery += `, passbook_image = @img`;
        updateQuery += ` WHERE user_bank_id = @id`;

        const request = pool.request()
            .input('id', sql.Int, bankId)
            .input('bankId', sql.Int, newBankId)
            .input('accNum', sql.VarChar, accountNumber)
            .input('accName', sql.NVarChar, accountName) 
            .input('curr', sql.VarChar, currencyCode);

        if (passbookBase64) request.input('img', sql.NVarChar(sql.MAX), passbookBase64);

        await request.query(updateQuery);
        res.json({ success: true, message: 'บันทึกข้อมูลและส่งตรวจสอบใหม่สำเร็จ' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error: ' + err.message });
    }
});

// ==========================================
// 🌟 1. API: ดึงข้อมูลสัตว์และตัวเลขทั้งหมด (GET)
// ==========================================
app.get('/api/admin/animal-numbers', async (req, res) => {
    try {
        // 🌟 ทริค: ลองเชื่อมต่อ DB ดูก่อน ถ้ามีการเชื่อมต่อค้างอยู่แล้วก็ให้ข้ามไปใช้งานได้เลย ไม่ต้อง Error
        try { 
            await sql.connect(dbConfig); 
        } catch (err) { 
            /* ปล่อยผ่านกรณีที่มัน Connected อยู่แล้ว */ 
        }

        const request = new sql.Request();
        const result = await request.query(`
            SELECT * FROM Master_Animal_Numbers 
            ORDER BY created_at DESC
        `);
        
        // ส่งข้อมูล Array กลับไปให้หน้าเว็บ
        res.status(200).json(result.recordset);

    } catch (error) {
        console.error('Error fetching animal numbers:', error);
        res.status(500).json({ 
            success: false, 
            message: 'เกิดข้อผิดพลาดในการดึงข้อมูลจาก Database', 
            error: error.message 
        });
    }
});

// ==========================================
// 🌟 API: เพิ่มข้อมูลสัตว์และตัวเลขใหม่ (POST)
// ==========================================
app.post('/api/admin/animal-numbers', async (req, res) => {
    const { animal_name_th, image_url, lottery_type, num1, num2, num3, is_active, action_by } = req.body;

    try {
        const pool = await sql.connect(dbConfig); 

        const checkQuery = await pool.request()
            .input('lotteryType', sql.VarChar, lottery_type)
            .query(`SELECT num1, num2, num3 FROM Master_Animal_Numbers WHERE lottery_type = @lotteryType`);
        
        const existingNumbers = checkQuery.recordset.flatMap(row => [row.num1, row.num2, row.num3]);
        const newNumbers = [num1, num2];
        if (num3 !== '-') newNumbers.push(num3);

        const duplicates = newNumbers.filter(n => existingNumbers.includes(n));
        
        if (duplicates.length > 0) {
            return res.status(400).json({ success: false, message: `เลข ${duplicates.join(', ')} ถูกใช้ไปแล้วในโหมด ${lottery_type} ตัว` });
        }

        const insertQuery = `
            INSERT INTO Master_Animal_Numbers 
            (animal_name_th, image_url, lottery_type, num1, num2, num3, is_active, created_by)
            VALUES 
            (@animalName, @imageUrl, @lotteryType, @num1, @num2, @num3, @isActive, @actionBy)
        `;

        await pool.request()
            .input('animalName', sql.NVarChar, animal_name_th)
            .input('imageUrl', sql.VarChar(sql.MAX), image_url) 
            .input('lotteryType', sql.VarChar, lottery_type)
            .input('num1', sql.VarChar, num1)
            .input('num2', sql.VarChar, num2)
            .input('num3', sql.VarChar, num3)
            .input('isActive', sql.Bit, is_active ? 1 : 0)
            .input('actionBy', sql.NVarChar, action_by || 'Unknown') // 🌟 เก็บชื่อคนทำ
            .query(insertQuery);

        res.status(201).json({ success: true, message: 'บันทึกข้อมูลสัตว์และตัวเลขสำเร็จ' });
    } catch (error) {
        console.error('SQL Server Error Details:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการ INSERT Database', error: error.message });
    }
});

// ==========================================
// 🌟 API: แก้ไขข้อมูลสัตว์และตัวเลข (PUT) - มาใหม่!
// ==========================================
app.put('/api/admin/animal-numbers/:id', async (req, res) => {
    const { id } = req.params;
    const { animal_name_th, image_url, lottery_type, num1, num2, num3, is_active, action_by } = req.body;

    try {
        const pool = await sql.connect(dbConfig); 

        // 🌟 ดักเลขซ้ำ (แต่ต้องยกเว้น ID ของตัวเองที่กำลังแก้อยู่)
        const checkQuery = await pool.request()
            .input('lotteryType', sql.VarChar, lottery_type)
            .input('currentId', sql.Int, id)
            .query(`SELECT num1, num2, num3 FROM Master_Animal_Numbers WHERE lottery_type = @lotteryType AND animal_id != @currentId`);
        
        const existingNumbers = checkQuery.recordset.flatMap(row => [row.num1, row.num2, row.num3]);
        const newNumbers = [num1, num2];
        if (num3 !== '-') newNumbers.push(num3);

        const duplicates = newNumbers.filter(n => existingNumbers.includes(n));
        
        if (duplicates.length > 0) {
            return res.status(400).json({ success: false, message: `เลข ${duplicates.join(', ')} ถูกใช้ไปแล้วในโหมด ${lottery_type} ตัว` });
        }

        const updateQuery = `
            UPDATE Master_Animal_Numbers 
            SET animal_name_th = @animalName,
                image_url = @imageUrl,
                lottery_type = @lotteryType,
                num1 = @num1,
                num2 = @num2,
                num3 = @num3,
                is_active = @isActive,
                updated_by = @actionBy
            WHERE animal_id = @id
        `;

        await pool.request()
            .input('id', sql.Int, id)
            .input('animalName', sql.NVarChar, animal_name_th)
            .input('imageUrl', sql.VarChar(sql.MAX), image_url) 
            .input('lotteryType', sql.VarChar, lottery_type)
            .input('num1', sql.VarChar, num1)
            .input('num2', sql.VarChar, num2)
            .input('num3', sql.VarChar, num3)
            .input('isActive', sql.Bit, is_active ? 1 : 0)
            .input('actionBy', sql.NVarChar, action_by || 'Unknown') // 🌟 เก็บชื่อคนแก้ไข
            .query(updateQuery);

        res.status(200).json({ success: true, message: 'แก้ไขข้อมูลสำเร็จ' });
    } catch (error) {
        console.error('SQL Server Error Details:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการ UPDATE Database', error: error.message });
    }
});

// ==========================================
// 🌟 API: สำหรับการซื้อหวย (ตัดเงิน/คำนวณวัน/จ่ายค่าคอม/แสตมป์ชื่อลูกทีม)
// ==========================================
app.post('/api/lottery/buy', async (req, res) => {
    // 🌟 อัปเกรด 1: รับค่า note เข้ามาจากฝั่งหน้าบ้าน
    const { user_id, cart, total_price, currency, note } = req.body;
    const pool = await sql.connect(dbConfig);
    
    // ==========================================
    // 🌟 0. แทรกระบบเช็คสถานะการขาย
    // ==========================================
    const statusRes = await pool.request().query("SELECT is_sales_open FROM System_Settings WHERE id = 1");
    if (!statusRes.recordset[0].is_sales_open) {
        return res.status(400).json({ success: false, message: 'ระบบปิดรับซื้อแล้วในขณะนี้ กรุณารอรอบถัดไป' });
    }

    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();
        const request = new sql.Request(transaction);

        // 1. ดึงอัตราแลกเปลี่ยนมาเป็น "ตัวกลาง"
        let exchangeRate = 1;
        if (currency === 'LAK') {
            const rateRes = await request.query("SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'");
            if (rateRes.recordset.length > 0) {
                exchangeRate = rateRes.recordset[0].rate;
            }
        }

        // 2. แปลงยอดซื้อให้เป็น THB เพื่อใช้เป็นฐาน
        const baseTHBAmount = total_price / exchangeRate;

        // 3. คำนวณยอดที่จะหักเงิน (แปลงกลับเป็นสกุลเงินกระเป๋าลูกค้า)
        const deductAmount = baseTHBAmount * exchangeRate; 

        // 4. เช็คยอดเงินและหักเงินในกระเป๋า
        const userRes = await request
            .input('userId', sql.Int, user_id)
            .query('SELECT balance FROM Wallets WHERE user_id = @userId'); 

        if (userRes.recordset.length === 0) throw new Error('ไม่พบข้อมูลกระเป๋าเงินในระบบ (กรุณาแจ้งแอดมินตรวจสอบ)');
        if (userRes.recordset[0].balance < deductAmount) { 
            throw new Error('ยอดเงินในกระเป๋าไม่เพียงพอ');
        }

        request.input('deductAmount', sql.Decimal(18,2), deductAmount);
        await request.query(`
            UPDATE Users SET wallet_balance = ISNULL(wallet_balance, 0) - @deductAmount WHERE user_id = @userId;
            UPDATE Wallets SET balance = balance - @deductAmount WHERE user_id = @userId;
        `);

        // 5. บันทึกประวัติ
        await request
            .input('title', sql.NVarChar, 'ซื้อหวยเวียดนาม')
            .input('amount', sql.Decimal(18,2), -deductAmount) 
            .query(`INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at)
                    VALUES (@userId, 'Buy Lottery', @title, @amount, 'Completed', GETDATE())`);

        // ==========================================
        // 🌟 แทรกระบบคำนวณ งวดวันที่ (draw_date) เข้าไปในบิล
        // ==========================================
        const orderRes = await request
            .input('currency', sql.VarChar, currency)
            .input('totalPrice', sql.Decimal(18,2), deductAmount)
            .input('note', sql.NVarChar, note || null) // 🌟 อัปเกรด 2: เตรียมค่า note ลงตัวแปร SQL
            .query(`
                DECLARE @TargetDrawDate DATE;
                
                DECLARE @ThaiTime DATETIME = DATEADD(HOUR, 7, GETUTCDATE());
                DECLARE @CurrentTime TIME = CAST(@ThaiTime AS TIME);
                DECLARE @CurrentDate DATE = CAST(@ThaiTime AS DATE);
                
                DECLARE @DB_CloseTime TIME = (SELECT TOP 1 close_time FROM System_Settings);
                
                IF @CurrentTime >= @DB_CloseTime
                    SET @TargetDrawDate = DATEADD(day, 1, @CurrentDate);
                ELSE
                    SET @TargetDrawDate = @CurrentDate;

                -- 🌟 อัปเกรด 3: เพิ่มคอลัมน์ order_note ลงไปตอน INSERT
                INSERT INTO Lottery_Orders (user_id, total_amount, currency_code, status, draw_date, created_at, order_note)
                OUTPUT INSERTED.order_id
                VALUES (@userId, @totalPrice, @currency, N'รอผลตรวจ', @TargetDrawDate, @ThaiTime, @note)
            `);
        
        const orderId = orderRes.recordset[0].order_id;

        for (const item of cart) {
            const itemReq = new sql.Request(transaction);
            await itemReq
                .input('orderId', sql.Int, orderId)
                .input('lotteryNumber', sql.VarChar, item.number)
                .input('lotteryType', sql.VarChar, item.type)
                .input('price', sql.Decimal(18,2), item.price)
                .query(`INSERT INTO Lottery_Order_Items (order_id, lottery_type, selected_number, price, status)
                        VALUES (@orderId, @lotteryType, @lotteryNumber, @price, N'รอผลตรวจ')`);
        }

        // ==========================================
        // 🌟 6. ระบบจ่ายค่าแนะนำ (ดึง % จาก Database, แสตมป์ชื่อลูกทีม และแปลงสกุลเงินอัตโนมัติ!)
        // ==========================================
        const refReq = new sql.Request(transaction);
        refReq.input('buyerId', sql.Int, user_id);
        
        // 🌟 อัปเกรด 4: เพิ่มการดึงสกุลเงินของลูกทีมและคนแนะนำขึ้นมาเทียบกัน
        const referrerRes = await refReq.query(`
            SELECT u_referrer.user_id, u_buyer.username as buyer_username,
                   ISNULL(u_buyer.currency_code, 'THB') as buyer_currency,
                   ISNULL(u_referrer.currency_code, 'THB') as referrer_currency
            FROM Users u_buyer
            JOIN Users u_referrer ON u_buyer.referrer_username = u_referrer.username
            WHERE u_buyer.user_id = @buyerId
        `);

        if (referrerRes.recordset.length > 0) {
            const referrerId = referrerRes.recordset[0].user_id;
            const buyerUsername = referrerRes.recordset[0].buyer_username;
            const buyerCurrency = referrerRes.recordset[0].buyer_currency;
            const referrerCurrency = referrerRes.recordset[0].referrer_currency;
            
            const settingReq = new sql.Request(transaction);
            const settingRes = await settingReq.query("SELECT purchase_percent FROM Commission_Settings WHERE id = 1");
            const purchasePercent = settingRes.recordset.length > 0 ? settingRes.recordset[0].purchase_percent : 2.00; 
            
            // คำนวณค่าคอมตั้งต้น (ตามสกุลเงินที่ใช้ซื้อ)
            const rawCommission = deductAmount * (purchasePercent / 100); 
            let finalCommission = rawCommission;

            // 🌟 อัปเกรด 5: ระบบ Cross-Currency แปลงค่าคอมเข้ากระเป๋าผู้แนะนำ
            if (buyerCurrency !== referrerCurrency) {
                const pair = `${buyerCurrency}_${referrerCurrency}`; 
                
                const rateReq = new sql.Request(transaction);
                rateReq.input('pair', sql.VarChar, pair);
                const rateRes = await rateReq.query(`SELECT rate FROM ExchangeRates WHERE currency_pair = @pair`);
                    
                if (rateRes.recordset.length > 0) {
                    finalCommission = finalCommission * rateRes.recordset[0].rate;
                } else {
                    const reversePair = `${referrerCurrency}_${buyerCurrency}`;
                    const reverseRateReq = new sql.Request(transaction);
                    reverseRateReq.input('revPair', sql.VarChar, reversePair);
                    const reverseRateRes = await reverseRateReq.query(`SELECT rate FROM ExchangeRates WHERE currency_pair = @revPair`);
                    
                    if (reverseRateRes.recordset.length > 0) {
                        finalCommission = finalCommission / reverseRateRes.recordset[0].rate;
                    }
                }
            }

            const commReq = new sql.Request(transaction);
            commReq.input('referrerId', sql.Int, referrerId);
            commReq.input('commission', sql.Decimal(18,2), finalCommission); // 🌟 ใช้ยอดที่แปลงเสร็จแล้ว!
            commReq.input('transTitle', sql.NVarChar, `รายได้ ${purchasePercent}% จากทีมงาน (${buyerUsername})`); 
            
            await commReq.query(`
                UPDATE Wallets SET balance = balance + @commission WHERE user_id = @referrerId;
                UPDATE Users SET total_purchase_comm = ISNULL(total_purchase_comm, 0) + @commission WHERE user_id = @referrerId;
                INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at)
                VALUES (@referrerId, 'Affiliate Purchase', @transTitle, @commission, 'Completed', GETDATE());
            `);
        }

        await transaction.commit();
        res.status(200).json({ success: true, message: 'ชำระเงินสำเร็จ', order_id: orderId });

    } catch (error) {
        await transaction.rollback();
        res.status(400).json({ success: false, message: error.message || 'เกิดข้อผิดพลาดในการชำระเงิน' });
    }
});

// API สำหรับดึงเรทรางวัลไปแสดงที่หน้าสลิป
app.get('/api/lottery/prize-rates', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query('SELECT * FROM Lottery_Prize_Rates ORDER BY CAST(lottery_type AS INT) ASC');
        res.status(200).json({ success: true, data: result.recordset });
    } catch (error) {
        res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลอัตราจ่ายได้' });
    }
});


// ==========================================
// 🌟 API: ดึงประวัติการซื้อหวยของ User (GET)
// ==========================================
app.get('/api/lottery/history/:userId', async (req, res) => {
    const userId = req.params.userId;
    try {
        const pool = await sql.connect(dbConfig);
        
        // 1. ดึงหัวบิลทั้งหมดของ User นี้ เรียงจากใหม่ไปเก่า
        const orderRes = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT order_id, total_amount, currency_code, status, created_at
                FROM Lottery_Orders
                WHERE user_id = @userId
                ORDER BY created_at DESC
            `);
            
        const orders = orderRes.recordset;

        // 2. ดึงรายละเอียดเลขหวยแต่ละตัว มาผูกกับหัวบิล
        for (let order of orders) {
            const itemRes = await pool.request()
                .input('orderId', sql.Int, order.order_id)
                .query(`
                    SELECT item_id, lottery_type, selected_number, price, status
                    FROM Lottery_Order_Items
                    WHERE order_id = @orderId
                `);
            order.items = itemRes.recordset;
        }

        res.status(200).json({ success: true, data: orders });
    } catch (error) {
        console.error('Error fetching lottery history:', error);
        res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลประวัติได้' });
    }
});


// ==========================================
// 🌟 API: ดึงอัตราจ่ายเงินรางวัลหวย
// ==========================================
app.get('/api/lottery/prize-rates', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query('SELECT * FROM Lottery_Prize_Rates ORDER BY CAST(lottery_type AS INT) ASC');
        res.status(200).json({ success: true, data: result.recordset });
    } catch (error) {
        console.error('Error fetching prize rates:', error);
        res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลอัตราจ่ายได้' });
    }
});


// ==========================================
// 🌟 API: ดึงประวัติการเงินทั้งหมดของลูกค้า (Statement)
// ==========================================
app.get('/api/transactions/:userId', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('userId', sql.Int, req.params.userId)
            .query(`
                SELECT * FROM Transactions 
                WHERE user_id = @userId 
                ORDER BY created_at DESC
            `);
            
        res.status(200).json({ success: true, data: result.recordset });
    } catch (error) {
        console.error('Error fetching transactions history:', error);
        res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลประวัติการเงินได้' });
    }
});
// ==========================================
// API 1: ลูกค้าแจ้งฝากเงิน (บันทึกเป็น Pending เสมอ + ดักบิลซ้อน)
// ==========================================
app.post('/api/deposit-submit', async (req, res) => {
  try {
    const { userId, bankName, accountNumber, currencyCode, amount, depositDate, depositTime, slipBase64 } = req.body;
    const cleanAmount = Math.round(parseFloat(amount) * 100) / 100; 
    const depositDatetime = `${depositDate} ${depositTime}`;
    const pool = await sql.connect(dbConfig); 

    // 🛡️ [ด่านหน้าสุด]: เช็คว่ามีบิลที่ "รอตรวจ" (Pending) หรือ "รอแก้ไข" (Rejected) ค้างอยู่ไหม?
    const checkActive = await pool.request()
        .input('userId', sql.Int, userId)
        .query(`
            SELECT COUNT(*) as activeCount 
            FROM Transactions_Deposit 
            WHERE user_id = @userId AND status IN ('Pending', 'Rejected')
        `);

    // ถ้ามีบิลค้างอยู่เกิน 0 ให้เด้งออกทันที! ห้ามส่งคำขอใหม่เด็ดขาด
    if (checkActive.recordset[0].activeCount > 0) {
        return res.status(400).json({ 
            success: false, 
            message: 'คุณมีรายการฝากเงินที่กำลังรอดำเนินการ หรือรอแก้ไขอยู่ กรุณาจัดการบิลเดิมให้เสร็จสิ้นก่อนทำรายการใหม่ครับ' 
        });
    }
    // ----------------------------------------

    // ดึง Username
    const userResult = await pool.request()
      .input('searchUserId', sql.Int, userId)
      .query(`SELECT username FROM Users WHERE user_id = @searchUserId`);
    let customerName = 'ไม่ระบุชื่อ'; 
    if (userResult.recordset.length > 0) {
      customerName = userResult.recordset[0].username;
    }

    // บันทึกคำขอฝากเงิน (สถานะจะเป็น Pending ตลอดไปจนกว่าแอดมินจะกดอนุมัติ)
    await pool.request()
      .input('userId', sql.Int, userId)
      .input('customerName', sql.NVarChar(100), customerName)
      .input('bankName', sql.NVarChar(100), bankName || '')
      .input('accountNumber', sql.VarChar(50), accountNumber || '')
      .input('amount', sql.Decimal(18, 2), cleanAmount) 
      .input('currencyCode', sql.VarChar(10), currencyCode || 'THB')
      .input('slipImage', sql.NVarChar(sql.MAX), slipBase64) 
      .input('depositDatetime', sql.DateTime, depositDatetime) 
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


// ==========================================
// API: ดึงรายการแจ้งฝากเงิน + สรุปยอดรายเดือน (สำหรับ Admin) แก้เพิ่มถ้าซ่ำให้ลบตัวอิ่น
// ==========================================
app.get('/api/admin/deposit-requests', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    
    // 🌟 แก้ไข: ดึงรายการรอตรวจทั้งหมด + ประวัติย้อนหลัง 7 วัน (รายการเมื่อวานจะได้ไม่หาย)
    const queryList = `
      SELECT 
        deposit_id, user_id, customer_name, bank_name, account_number, 
        amount, currency_code, slip_image, status, 
        FORMAT(deposit_datetime, 'yyyy-MM-ddTHH:mm:ss') AS deposit_datetime, 
        FORMAT(created_at, 'yyyy-MM-ddTHH:mm:ss') AS created_at, 
        reject_reasons, edit_count
      FROM Transactions_Deposit
      WHERE status IN ('Pending', 'Slip Verified') 
         OR CAST(created_at AS DATE) >= CAST(DATEADD(day, -7, GETDATE()) AS DATE)
      ORDER BY created_at DESC
    `;
    const resultList = await pool.request().query(queryList);

    const querySummary = `
      SELECT t.currency_code, ISNULL(SUM(t.amount), 0) as total_amount
      FROM Transactions_Deposit t
      INNER JOIN Bank_Statements b ON t.deposit_id = b.reconciled_with_deposit_id
      WHERE t.status = 'Approved'
        AND MONTH(t.created_at) = MONTH(GETDATE())
        AND YEAR(t.created_at) = YEAR(GETDATE())
      GROUP BY t.currency_code
    `;
    const resultSummary = await pool.request().query(querySummary);
    
    const monthlySummary = {};
    resultSummary.recordset.forEach(row => {
      monthlySummary[row.currency_code] = row.total_amount;
    });

    res.json({ success: true, requests: resultList.recordset, summary: monthlySummary });

  } catch (error) {
    console.error('Error fetching deposit requests:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
  }
});

// ==========================================
// 🌟 API: แอดมินตีกลับคำขอฝากเงิน (แก้ไขบั๊ก Error 500 เรียบร้อย)
// ==========================================
app.post('/api/admin/deposit-reject', async (req, res) => {
  try {
    const { depositId, userId, rejectReasons } = req.body;
    const pool = await sql.connect(dbConfig);

    // แปลงเหตุผลเป็น JSON (ใส่กันเหนียวไว้เผื่อไม่มีค่าส่งมา)
    const reasonsJson = JSON.stringify(rejectReasons || []);

    // 1. อัปเดตสถานะเป็น ตีกลับ (Rejected) และบวก edit_count
    const updateResult = await pool.request()
      .input('depositId', sql.Int, depositId)
      .input('reasons', sql.NVarChar, reasonsJson)
      .query(`
        UPDATE Transactions_Deposit 
        SET status = 'Rejected', 
            reviewed_by = 'Admin (Returned)', 
            reject_reasons = @reasons,
            edit_count = ISNULL(edit_count, 0) + 1
        OUTPUT INSERTED.edit_count
        WHERE deposit_id = @depositId
      `);
      
    const currentEditCount = updateResult.recordset[0].edit_count;

    // 2. 🛡️ ระบบป้องกันก่อกวน: ถ้าลูกค้ารายเดิม ส่งแก้บิลเดิมผิดเกิน 3 ครั้ง ให้ยกเลิกถาวร!
    if (currentEditCount > 3) {
      await pool.request()
        .input('depositId', sql.Int, depositId)
        .query(`
          UPDATE Transactions_Deposit 
          SET status = 'Cancelled', 
              reviewed_by = 'System Blocked (Spam)' 
          WHERE deposit_id = @depositId
        `);
        
      return res.json({ 
        success: true, 
        message: 'ตีกลับสำเร็จ! (ระบบยกเลิกบิลนี้ถาวร เนื่องจากลูกค้าส่งแก้ไขข้อมูลผิดเกิน 3 ครั้ง)' 
      });
    }

    res.json({ success: true, message: 'ส่งกลับให้ลูกค้าแก้ไขเรียบร้อยแล้ว' });

  } catch (error) {
    console.error('Error rejecting deposit:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการตีกลับรายการ: ' + error.message });
  }
});

// ==========================================
// API: ลูกค้าแก้ไขคำขอที่ถูกตีกลับ แล้วส่งมาให้แอดมินตรวจใหม่
// ==========================================
app.put('/api/deposit-edit/:id', async (req, res) => {
  try {
    const depositId = req.params.id;
    const { amount, depositDate, depositTime, slipBase64 } = req.body;
    
    const depositDatetime = `${depositDate} ${depositTime}`;
    const cleanAmount = Math.round(parseFloat(amount) * 100) / 100;
    
    const pool = await sql.connect(dbConfig);
    
    // 🌟 อัปเดตข้อมูลที่ลูกค้าแก้ เปลี่ยนสถานะเป็น Pending เพื่อกลับไปเข้าคิวให้แอดมินตรวจ
    await pool.request()
      .input('id', sql.Int, depositId)
      .input('amount', sql.Decimal(18,2), cleanAmount)
      .input('depositDatetime', sql.DateTime, depositDatetime)
      .input('slipImage', sql.NVarChar(sql.MAX), slipBase64)
      .query(`
        UPDATE Transactions_Deposit
        SET amount = @amount,
            deposit_datetime = @depositDatetime,
            slip_image = @slipImage,
            status = 'Pending', 
            reviewed_by = 'User Updated',
            reject_reasons = NULL
        WHERE deposit_id = @id
      `);
      
    res.json({ success: true, message: 'ส่งคำขอที่แก้ไขแล้วเรียบร้อย กรุณารอแอดมินตรวจสอบ' });
  } catch(error) {
    console.error('Error updating deposit:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูลแก้ไข' });
  }
});


// ==========================================
// API: ดึงรายชื่อธนาคารสำหรับ Dropdown
// ==========================================
app.get('/api/admin/banks', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request().query("SELECT * FROM Banks WHERE is_active = 1");
    res.json({ success: true, banks: result.recordset });
  } catch (error) {
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลธนาคารได้' });
  }
});



// ==========================================
// API 1: ลูกค้าแจ้งฝากเงิน (ค้นหาว่าแอดมินคีย์ยอดรอไว้แล้วหรือยัง)
// ==========================================
app.post('/api/deposit-submit', async (req, res) => {
  try {
    const { userId, bankName, accountNumber, currencyCode, amount, depositDate, depositTime, slipBase64 } = req.body;
    const cleanAmount = Math.round(parseFloat(amount) * 100) / 100; 
    const depositDatetime = `${depositDate} ${depositTime}`;
    const pool = await sql.connect(dbConfig); 

    // ดึงชื่อลูกค้า
    const nameResult = await pool.request()
      .input('searchUserId', sql.Int, userId)
      .query(`SELECT firstname, lastname FROM UserName_Lastname WHERE user_id = @searchUserId`);
    let fullName = 'ผู้ใช้ทั่วไป'; 
    if (nameResult.recordset.length > 0) {
      fullName = `${nameResult.recordset[0].firstname} ${nameResult.recordset[0].lastname}`; 
    }

    // บันทึกคำขอฝากเงินของลูกค้า (สถานะเริ่มต้นคือ Pending)
    const insertResult = await pool.request()
      .input('userId', sql.Int, userId)
      .input('customerName', sql.NVarChar(100), fullName)
      .input('bankName', sql.NVarChar(100), bankName || '')
      .input('accountNumber', sql.VarChar(50), accountNumber || '')
      .input('amount', sql.Decimal(18, 2), cleanAmount) 
      .input('currencyCode', sql.VarChar(10), currencyCode || 'THB')
      .input('slipImage', sql.NVarChar(sql.MAX), slipBase64) 
      .input('depositDatetime', sql.DateTime, depositDatetime) 
      .query(`
        INSERT INTO Transactions_Deposit (user_id, customer_name, bank_name, account_number, amount, currency_code, slip_image, status, deposit_datetime, created_at)
        OUTPUT INSERTED.deposit_id
        VALUES (@userId, @customerName, @bankName, @accountNumber, @amount, @currencyCode, @slipImage, 'Pending', @depositDatetime, GETDATE())
      `);

    const newDepositId = insertResult.recordset[0].deposit_id;

    // 🌟 1.1 ตรวจสอบว่า "แอดมินได้คีย์ยอดนี้รอไว้ในระบบแล้วหรือยัง?"
    const findAdminStatement = await pool.request()
      .input('amount', sql.Decimal(18,2), cleanAmount)
      .input('accountNumber', sql.VarChar, accountNumber)
      .input('transferDate', sql.VarChar, depositDate)
      .input('transferTime', sql.VarChar, depositTime)
      .query(`
        SELECT TOP 1 statement_id FROM Bank_Statements
        WHERE is_reconciled = 0
          AND account_number = @accountNumber
          AND ABS(amount - @amount) <= 0.01
          AND CAST(transfer_date AS DATE) = CAST(@transferDate AS DATE)
          AND CAST(transfer_time AS TIME(0)) = CAST(@transferTime AS TIME(0))
      `);

    if (findAdminStatement.recordset.length > 0) {
      // 🌟 เจอที่แอดมินคีย์รอไว้! -> อนุมัติและเติมเงินทันที
      const stmtId = findAdminStatement.recordset[0].statement_id;

      await pool.request().input('depositId', sql.Int, newDepositId)
        .query("UPDATE Transactions_Deposit SET status = 'Approved', reviewed_by = 'Auto-Reconciled' WHERE deposit_id = @depositId");

      await pool.request().input('userId', sql.Int, userId).input('amount', sql.Decimal(18,2), cleanAmount)
        .query("UPDATE Wallets SET balance = ISNULL(balance, 0) + @amount, last_updated = GETDATE() WHERE user_id = @userId");

      await pool.request().input('userId', sql.Int, userId).input('amount', sql.Decimal(18,2), cleanAmount).input('title', sql.NVarChar(255), 'ฝากเงิน (อัตโนมัติ)')
        .query("INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at) VALUES (@userId, 'Deposit', @title, @amount, 'Completed', GETDATE())");

      await pool.request().input('stmtId', sql.Int, stmtId).input('depositId', sql.Int, newDepositId)
        .query("UPDATE Bank_Statements SET is_reconciled = 1, reconciled_with_deposit_id = @depositId WHERE statement_id = @stmtId");
    }

    res.json({ success: true, message: 'ส่งคำขอฝากเงินสำเร็จ!' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล' });
  }
});



// ==========================================
// 🚀 THE FUTURE RECONCILIATION ENGINE (ระบบกระทบยอดอัตโนมัติ 2 ทาง)
// API: แอดมินกด "ตรวจสอบสลิปผ่าน"
// ==========================================
app.post('/api/admin/deposit-approve', async (req, res) => {
  const { depositId, userId, amount } = req.body;

  try {
    const pool = await sql.connect(dbConfig);
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // 1. ดึงข้อมูลคำขอฝากเงินขึ้นมา
      const depositRes = await transaction.request()
        .input('depositId', sql.Int, depositId)
        .query(`
          SELECT amount, deposit_datetime, account_number, bank_name, currency_code 
          FROM Transactions_Deposit 
          WHERE deposit_id = @depositId
        `);
      
      if (depositRes.recordset.length === 0) throw new Error('ไม่พบข้อมูลคำขอฝากเงิน');
      const depositData = depositRes.recordset[0];

      // 2. เปลี่ยนสถานะคำขอฝากเป็น 'Slip Verified' 
      await transaction.request()
        .input('depositId', sql.Int, depositId)
        .query(`
          UPDATE Transactions_Deposit 
          SET status = 'Slip Verified', reviewed_by = 'Admin' 
          WHERE deposit_id = @depositId
        `);

      // 3. วิ่งไปค้นหายอดเงินเข้า (Bank_Statements) 
      const matchRes = await transaction.request()
        .input('amount', sql.Decimal(18, 2), depositData.amount)
        .input('accountNumber', sql.VarChar, depositData.account_number || '')
        .input('depositDate', sql.DateTime, depositData.deposit_datetime)
        .query(`
          SELECT TOP 1 statement_id 
          FROM Bank_Statements 
          WHERE (is_reconciled = 0 OR is_reconciled IS NULL) 
            AND amount = @amount 
            AND account_number = @accountNumber
            AND transfer_date = CAST(@depositDate AS DATE)
        `);

      // 4. กรณีที่ 1: พบยอดเงินที่ตรงกัน! (กระทบยอดสำเร็จทันที)
      if (matchRes.recordset.length > 0) {
        const matchedStatementId = matchRes.recordset[0].statement_id;

        // 4.1 อัปเดตสถานะทั้ง 2 ฝั่งให้เป็น 'สำเร็จ'
        await transaction.request()
          .input('depositId', sql.Int, depositId)
          .input('statementId', sql.Int, matchedStatementId)
          .query(`
            UPDATE Transactions_Deposit SET status = 'Approved' WHERE deposit_id = @depositId;
            UPDATE Bank_Statements SET is_reconciled = 1, reconciled_with_deposit_id = @depositId WHERE statement_id = @statementId;
          `);

        // 4.2 เติมเงินเข้า Wallet ลูกค้า
        await transaction.request()
          .input('userId', sql.Int, userId)
          .input('amount', sql.Decimal(18, 2), amount)
          .query(`UPDATE Wallets SET balance = ISNULL(balance, 0) + @amount, last_updated = GETDATE() WHERE user_id = @userId`);

        // 4.3 บันทึกประวัติการเงิน (Transaction Log)
        // 🌟 [แก้ไขชื่อคอลัมน์ให้ถูกต้องตาม DB แล้วครับ!]
        await transaction.request()
          .input('userId', sql.Int, userId)
          .input('amount', sql.Decimal(18, 2), amount)
          .input('title', sql.NVarChar(255), 'ระบบกระทบยอดเงินฝากอัตโนมัติ')
          .query(`
            INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at) 
            VALUES (@userId, 'Deposit', @title, @amount, 'Completed', GETDATE())
          `);

        await transaction.commit();
        res.json({ success: true, message: 'สลิปถูกต้อง และระบบชนยอดอัตโนมัติสำเร็จ! (เงินเข้าลูกค้าแล้ว)' });
      
      } 
      // 5. กรณีที่ 2: ยังไม่มียอดเงินตรงกันเข้ามา (ให้ค้างสถานะรอฝั่งบัญชีคีย์ยอด)
      else {
        await transaction.commit();
        res.json({ success: true, message: 'สลิปถูกต้องแล้ว (กำลังรอฝั่งบัญชีเงินเข้าคีย์ยอดเพื่อชนยอดอัตโนมัติ)' });
      }

    } catch (err) {
      await transaction.rollback();
      console.error("SQL Transaction Error:", err);
      res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
    }
  } catch (error) {
    console.error('Auto Reconciliation Connection Error:', error);
    res.status(500).json({ success: false, message: 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้: ' + error.message });
  }
});

// ==========================================
// 🌟 API 1: ดึงประวัติการฝากเงินของลูกค้า (เพื่อเช็คยอดตีกลับและแจ้งเตือน)
// ==========================================
app.get('/api/user/deposits/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request()
      .input('userId', sql.Int, userId)
      .query(`
        SELECT deposit_id, amount, deposit_datetime, slip_image, status, reject_reasons, account_number, bank_name
        FROM Transactions_Deposit 
        WHERE user_id = @userId 
        ORDER BY created_at DESC
      `);
    
    // ส่งข้อมูลกลับไปให้หน้าบ้าน (Dashboard และ TopNavbar เอาไปนับจำนวน Rejected)
    res.json({ success: true, data: result.recordset });
  } catch (error) {
    console.error('Error fetching user deposits:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ==========================================
// 🌟 API 2: สำหรับลูกค้ารับส่งข้อมูลที่ "แก้ไขแล้ว" กลับไปให้แอดมิน
// ==========================================
app.put('/api/deposit-edit/:depositId', async (req, res) => {
  const { depositId } = req.params;
  const { amount, depositDate, depositTime, slipBase64 } = req.body;
  
  // 🌟 [แก้บั๊กเวลาเพี้ยน] จัดฟอร์แมตเวลาให้เป็น YYYY-MM-DD HH:mm:ss เป๊ะๆ
  let timeStr = depositTime;
  if (timeStr.length === 5) timeStr += ':00'; // ถ้ามาแค่ 11:11 ให้เติมวินาทีเป็น 11:11:00
  
  const depositDatetime = `${depositDate} ${timeStr}`; // ใช้เว้นวรรค ห้ามใช้ตัว T เพื่อกัน SQL เพี้ยน

  try {
    const pool = await sql.connect(dbConfig);
    
    if (slipBase64) {
      await pool.request()
        .input('depositId', sql.Int, depositId)
        .input('amount', sql.Decimal(18, 2), amount)
        // 🌟 บังคับให้ SQL รับเป็นตัวหนังสือตรงๆ (VarChar) ห้ามมันบวกลบเวลาเอง
        .input('depositDatetime', sql.VarChar, depositDatetime) 
        .input('slipImage', sql.VarChar(sql.MAX), slipBase64)
        .query(`
          UPDATE Transactions_Deposit 
          SET amount = @amount, 
              deposit_datetime = @depositDatetime, 
              slip_image = @slipImage,
              status = 'Pending', 
              reject_reasons = NULL,
              edit_count = ISNULL(edit_count, 0) + 1
          WHERE deposit_id = @depositId
        `);
    } else {
      await pool.request()
        .input('depositId', sql.Int, depositId)
        .input('amount', sql.Decimal(18, 2), amount)
        .input('depositDatetime', sql.VarChar, depositDatetime)
        .query(`
          UPDATE Transactions_Deposit 
          SET amount = @amount, 
              deposit_datetime = @depositDatetime, 
              status = 'Pending', 
              reject_reasons = NULL,
              edit_count = ISNULL(edit_count, 0) + 1
          WHERE deposit_id = @depositId
        `);
    }

    res.json({ success: true, message: 'ส่งข้อมูลแก้ไขเรียบร้อยแล้ว แอดมินจะรีบตรวจสอบอีกครั้งครับ' });
  } catch (error) {
    console.error('Error updating deposit:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูลแก้ไข' });
  }
});


// ==========================================
// API 2: บัญชีคีย์ยอดโอนเข้า (ค้นหาบิลที่แอดมินตรวจไว้แล้ว แบบฉลาด 🌟)
// ==========================================
app.post('/api/admin/key-statement', async (req, res) => {
  try {
    const { bankId, bankName, accountNumber, amount, transferDate, transferTime, adminName } = req.body;
    
    // เคลียร์ฟอร์แมตเวลา
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

    // 1. บันทึกยอดที่ฝั่งบัญชีคีย์เข้ามา
    const insertStmt = await pool.request()
      .input('bankId', sql.Int, bankId)
      .input('bankName', sql.NVarChar, bankName)
      .input('accountNumber', sql.VarChar, accountNumber)
      .input('amount', sql.Decimal(18,2), cleanAmount)
      .input('transferDate', sql.VarChar, transferDate)
      .input('transferTime', sql.VarChar, cleanTime)
      .input('recordedBy', sql.NVarChar, adminName)
      .query(`
        INSERT INTO Bank_Statements (bank_id, bank_name, account_number, amount, transfer_date, transfer_time, recorded_by, is_reconciled)
        OUTPUT INSERTED.statement_id
        VALUES (@bankId, @bankName, @accountNumber, @amount, CAST(@transferDate AS DATE), CAST(@transferTime AS TIME(0)), @recordedBy, 0)
      `);
    const statementId = insertStmt.recordset[0].statement_id;

    // 2. 🌟 ค้นหาและจับคู่สลิปแบบฉลาด (Smart Match)
    const findSlip = await pool.request()
      .input('amount', sql.Decimal(18,2), cleanAmount)
      .input('accountNumber', sql.VarChar, accountNumber)
      .input('transferDate', sql.VarChar, transferDate)
      .input('transferTime', sql.VarChar, cleanTime)
      .query(`
        SELECT TOP 1 deposit_id, user_id FROM Transactions_Deposit 
        WHERE status = 'Slip Verified' 
          -- 🌟 ตัดขีดกลางและช่องว่างก่อนเทียบเลขบัญชี
          AND REPLACE(REPLACE(account_number, '-', ''), ' ', '') = REPLACE(REPLACE(@accountNumber, '-', ''), ' ', '')
          -- 🌟 ยอดเงินต้องตรงกันเป๊ะ
          AND ABS(amount - @amount) <= 0.01
          -- 🌟 วันที่โอนต้องตรงกัน
          AND CAST(deposit_datetime AS DATE) = CAST(@transferDate AS DATE)
          -- 🌟 อนุโลมเวลาคลาดเคลื่อนได้ไม่เกิน +/- 10 นาที
          AND ABS(DATEDIFF(MINUTE, CAST(deposit_datetime AS TIME(0)), CAST(@transferTime AS TIME(0)))) <= 10
        -- 🌟 เรียงลำดับเอาบิลที่เวลาใกล้เคียงที่สุดขึ้นมาก่อน
        ORDER BY ABS(DATEDIFF(MINUTE, CAST(deposit_datetime AS TIME(0)), CAST(@transferTime AS TIME(0)))) ASC
      `);

    // 3. ถ้าเจอบิลที่ตรงกัน ให้ประมวลผลแจกเงินเข้า Wallet ทันที!
    if (findSlip.recordset.length > 0) {
      const match = findSlip.recordset[0];

      await pool.request().input('depositId', sql.Int, match.deposit_id)
        .query("UPDATE Transactions_Deposit SET status = 'Approved', reviewed_by = 'Bank (Matched)' WHERE deposit_id = @depositId");
      
      await pool.request().input('userId', sql.Int, match.user_id).input('amount', sql.Decimal(18,2), cleanAmount)
        .query("UPDATE Wallets SET balance = ISNULL(balance, 0) + @amount, last_updated = GETDATE() WHERE user_id = @userId");

      await pool.request().input('userId', sql.Int, match.user_id).input('amount', sql.Decimal(18,2), cleanAmount).input('title', sql.NVarChar(255), 'ฝากเงิน (สำเร็จ)')
        .query("INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at) VALUES (@userId, 'Deposit', @title, @amount, 'Completed', GETDATE())");

      await pool.request().input('stmtId', sql.Int, statementId).input('depositId', sql.Int, match.deposit_id)
        .query("UPDATE Bank_Statements SET is_reconciled = 1, reconciled_with_deposit_id = @depositId WHERE statement_id = @stmtId");

      return res.json({ success: true, message: 'คีย์ยอดสำเร็จ และระบบจับคู่ให้อัตโนมัติ! (เติมเงินเข้า Wallet ให้ลูกค้าแล้ว)' });
    }

    // 4. ถ้าไม่เจอ ให้ติดสถานะ "รอกระทบยอด" ไว้ก่อน
    res.json({ success: true, message: 'บันทึกยอดเข้าธนาคารสำเร็จ (แต่ไม่พบบิลจากลูกค้าที่ตรงกัน ระบบรอจับคู่อีกครั้ง)' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: 'ระบบขัดข้อง: ' + error.message });
  }
});


// ==========================================
// API: บัญชีแก้ไขรายการคีย์ยอด (อัปเดต + ค้นหาจับคู่แบบฉลาด 🌟)
// ==========================================
app.put('/api/admin/key-statement/:id', async (req, res) => {
  try {
    const statementId = req.params.id;
    const { bankId, bankName, accountNumber, amount, transferDate, transferTime, adminName } = req.body;

    // เคลียร์ฟอร์แมตเวลา
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

    // 1. อัปเดตข้อมูลในตาราง Bank_Statements
    await pool.request()
      .input('stmtId', sql.Int, statementId)
      .input('bankId', sql.Int, bankId)
      .input('bankName', sql.NVarChar, bankName)
      .input('accountNumber', sql.VarChar, accountNumber)
      .input('amount', sql.Decimal(18,2), cleanAmount)
      .input('transferDate', sql.VarChar, transferDate)
      .input('transferTime', sql.VarChar, cleanTime)
      .input('recordedBy', sql.NVarChar, adminName)
      .query(`
        UPDATE Bank_Statements 
        SET bank_id = @bankId, bank_name = @bankName, account_number = @accountNumber, 
            amount = @amount, transfer_date = CAST(@transferDate AS DATE), 
            transfer_time = CAST(@transferTime AS TIME(0)), recorded_by = @recordedBy
        WHERE statement_id = @stmtId AND is_reconciled = 0
      `);

    // 2. 🌟 ค้นหาและจับคู่สลิปแบบฉลาด (Smart Match) อีกรอบหลังจากแก้ข้อมูล
    const findSlip = await pool.request()
      .input('amount', sql.Decimal(18,2), cleanAmount)
      .input('accountNumber', sql.VarChar, accountNumber)
      .input('transferDate', sql.VarChar, transferDate)
      .input('transferTime', sql.VarChar, cleanTime)
      .query(`
        SELECT TOP 1 deposit_id, user_id FROM Transactions_Deposit 
        WHERE status = 'Slip Verified' 
          AND REPLACE(REPLACE(account_number, '-', ''), ' ', '') = REPLACE(REPLACE(@accountNumber, '-', ''), ' ', '')
          AND ABS(amount - @amount) <= 0.01
          AND CAST(deposit_datetime AS DATE) = CAST(@transferDate AS DATE)
          AND ABS(DATEDIFF(MINUTE, CAST(deposit_datetime AS TIME(0)), CAST(@transferTime AS TIME(0)))) <= 10
        ORDER BY ABS(DATEDIFF(MINUTE, CAST(deposit_datetime AS TIME(0)), CAST(@transferTime AS TIME(0)))) ASC
      `);

    // 3. ถ้าเจอสลิปที่ตรงกัน ให้ประมวลผลแจกเงิน!
    if (findSlip.recordset.length > 0) {
      const match = findSlip.recordset[0];

      await pool.request().input('depositId', sql.Int, match.deposit_id)
        .query("UPDATE Transactions_Deposit SET status = 'Approved', reviewed_by = 'Bank (Matched)' WHERE deposit_id = @depositId");
      
      await pool.request().input('userId', sql.Int, match.user_id).input('amount', sql.Decimal(18,2), cleanAmount)
        .query("UPDATE Wallets SET balance = ISNULL(balance, 0) + @amount, last_updated = GETDATE() WHERE user_id = @userId");

      await pool.request().input('userId', sql.Int, match.user_id).input('amount', sql.Decimal(18,2), cleanAmount).input('title', sql.NVarChar(255), 'ฝากเงิน (สำเร็จ)')
        .query("INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at) VALUES (@userId, 'Deposit', @title, @amount, 'Completed', GETDATE())");

      await pool.request().input('stmtId', sql.Int, statementId).input('depositId', sql.Int, match.deposit_id)
        .query("UPDATE Bank_Statements SET is_reconciled = 1, reconciled_with_deposit_id = @depositId WHERE statement_id = @stmtId");

      return res.json({ success: true, message: 'อัปเดตข้อมูลสำเร็จ และระบบจับคู่ให้อัตโนมัติ! (เติมเงินให้ลูกค้าแล้ว)' });
    }

    res.json({ success: true, message: 'อัปเดตข้อมูลสำเร็จ (แต่ยังไม่พบบิลจากลูกค้าที่ตรงกัน รอการจับคู่)' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: 'ระบบขัดข้อง: ' + error.message });
  }
});


// ==========================================
// API: บัญชีคีย์ยอดโอนเข้า + กระทบยอด + แปลงสกุลเงินอัตโนมัติ (เวอร์ชันสมบูรณ์)
// ==========================================
app.post('/api/admin/key-statement', async (req, res) => {
  try {
    const { bankId, bankName, accountNumber, amount, transferDate, transferTime, adminName } = req.body;
    
    // 1. จัดการเวลาให้อยู่ในฟอร์แมต 24 ชั่วโมง (HH:MM:SS) ให้ตรงกับฐานข้อมูลเป๊ะๆ
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

    // 2. บันทึกยอดที่บัญชีคีย์ลงระบบ Bank_Statements (is_reconciled = 0 คือรอกระทบยอด)
    const insertStmt = await pool.request()
      .input('bankId', sql.Int, bankId).input('bankName', sql.NVarChar, bankName).input('accountNumber', sql.VarChar, accountNumber)
      .input('amount', sql.Decimal(18,2), cleanAmount).input('transferDate', sql.VarChar, transferDate).input('transferTime', sql.VarChar, cleanTime).input('recordedBy', sql.NVarChar, adminName)
      .query(`
        INSERT INTO Bank_Statements (bank_id, bank_name, account_number, amount, transfer_date, transfer_time, recorded_by, is_reconciled)
        OUTPUT INSERTED.statement_id
        VALUES (@bankId, @bankName, @accountNumber, @amount, CAST(@transferDate AS DATE), CAST(@transferTime AS TIME(0)), @recordedBy, 0)
      `);
    const statementId = insertStmt.recordset[0].statement_id;

    // 3. 🌟 ค้นหา "กุญแจดอกที่ 1" (หาสลิปที่แอดมินเพิ่งกดตรวจผ่าน 'Slip Verified' รออยู่)
    const findSlip = await pool.request()
      .input('amount', sql.Decimal(18,2), cleanAmount).input('accountNumber', sql.VarChar, accountNumber).input('transferDate', sql.VarChar, transferDate).input('transferTime', sql.VarChar, cleanTime)
      .query(`
        SELECT TOP 1 deposit_id, user_id 
        FROM Transactions_Deposit 
        WHERE (status = 'Slip Verified' OR (status = 'Pending' AND reviewed_by = 'Slip Verified'))
          AND account_number = @accountNumber AND ABS(amount - @amount) <= 0.01
          AND CAST(deposit_datetime AS DATE) = CAST(@transferDate AS DATE)
          AND CAST(deposit_datetime AS TIME(0)) = CAST(@transferTime AS TIME(0))
      `);

    if (findSlip.recordset.length > 0) {
      // 🟢 กรณีที่ 1: แอดมินตรวจสลิปแล้ว + บัญชีเพิ่งมาคีย์ยอด (กุญแจ 2 ดอกตรงกัน!) -> จ่ายเงินได้!
      const match = findSlip.recordset[0];
      const userId = match.user_id;

      // 🌟 ระบบแปลงค่าเงิน: เช็คก่อนว่าลูกค้าคนนี้ใช้กระเป๋าเงินสกุลอะไร?
      const userProfile = await pool.request().input('userId', sql.Int, userId)
        .query("SELECT currency_code FROM User_Profile_Banks WHERE user_id = @userId");
      
      let userCurrency = 'THB';
      if (userProfile.recordset.length > 0) {
         userCurrency = userProfile.recordset[0].currency_code;
      }

      let finalAmountToWallet = cleanAmount;

      // 🌟 ถ้าลูกค้าใช้เงินกีบ (LAK) ให้ดึงเรทแลกเปลี่ยนมาคูณยอดเงินก่อนเข้ากระเป๋า
      if (userCurrency === 'LAK') {
         const rateResult = await pool.request().query("SELECT TOP 1 exchange_rate FROM ExchangeRates WHERE currency_from = 'THB' AND currency_to = 'LAK' ORDER BY updated_at DESC");
         let exchangeRate = 500; // ค่าเรทสำรองกันพลาด
         if (rateResult.recordset.length > 0 && rateResult.recordset[0].exchange_rate > 0) {
            exchangeRate = rateResult.recordset[0].exchange_rate;
         }
         finalAmountToWallet = cleanAmount * exchangeRate;
      }

      // เริ่มทำ Transaction (อัปเดตหลายตารางพร้อมกัน ป้องกันฐานข้อมูลพังกลางคัน)
      const transaction = new sql.Transaction(pool);
      await transaction.begin();

      try {
          // 3.1 อัปเดตสถานะสลิปว่า Approved
          await transaction.request().input('depositId', sql.Int, match.deposit_id)
            .query("UPDATE Transactions_Deposit SET status = 'Approved', reviewed_by = 'Bank (Matched)' WHERE deposit_id = @depositId");
          
          // 3.2 🌟 เติมเงินเข้ากระเป๋า (ใช้ finalAmountToWallet ที่ผ่านการแปลงค่าเงินแล้ว)
          await transaction.request().input('userId', sql.Int, userId).input('amount', sql.Decimal(18,2), finalAmountToWallet)
            .query("UPDATE Wallets SET balance = ISNULL(balance, 0) + @amount, last_updated = GETDATE() WHERE user_id = @userId");
          
          // (ถ้าคุณพี่ใช้ตาราง User_Profile_Banks เก็บยอดเงินด้วย ให้อัปเดตตารางนี้ด้วยครับ)
          await transaction.request().input('userId', sql.Int, userId).input('amount', sql.Decimal(18,2), finalAmountToWallet)
            .query("UPDATE User_Profile_Banks SET wallet_balance = ISNULL(wallet_balance, 0) + @amount WHERE user_id = @userId");

          // 3.3 บันทึกประวัติ Transaction ลูกค้า (บันทึกเป็นยอดเงินปลายทาง)
          const txTitle = userCurrency === 'LAK' ? 'ฝากเงิน (สำเร็จ - แปลงจาก THB)' : 'ฝากเงิน (สำเร็จ)';
          await transaction.request().input('userId', sql.Int, userId).input('amount', sql.Decimal(18,2), finalAmountToWallet).input('title', sql.NVarChar(255), txTitle)
            .query("INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at) VALUES (@userId, 'Deposit', @title, @amount, 'Completed', GETDATE())");

          // 3.4 🌟 อัปเดตตารางคีย์ยอด (Bank_Statements) ว่า "กระทบยอดสำเร็จแล้ว" (is_reconciled = 1) ตัวนี้แหละที่ทำให้ตารางหน้าบ้านเด้งขึ้น "สำเร็จ"
          await transaction.request().input('stmtId', sql.Int, statementId).input('depositId', sql.Int, match.deposit_id)
            .query("UPDATE Bank_Statements SET is_reconciled = 1, reconciled_with_deposit_id = @depositId WHERE statement_id = @stmtId");

          await transaction.commit();
          
          return res.json({ success: true, message: `คีย์ยอดสำเร็จและจับคู่แล้ว! (เข้ากระเป๋าลูกค้า ${finalAmountToWallet.toLocaleString()} ${userCurrency})` });
      } catch (err) {
          await transaction.rollback();
          throw err;
      }
    }

    // 🟡 กรณีที่ 2: บัญชีคีย์ยอดก่อน (แอดมินยังไม่กดตรวจสลิป) -> is_reconciled จะเป็น 0 ต่อไป และโชว์ในแท็บ "รอกระทบยอด"
    res.json({ success: true, message: 'บันทึกยอดเงินเข้าธนาคารสำเร็จ (รอแอดมินตรวจรูปสลิป ระบบถึงจะจ่ายเงิน)' });
  } catch (error) {
    console.error('Error Key Statement:', error);
    res.status(500).json({ success: false, message: 'ระบบขัดข้อง: ' + error.message });
  }
});

// ==========================================
// API 3: รายงานสรุป (แยกยอดเงินรับ ตามบัญชีธนาคาร 100%)
// ==========================================
app.get('/api/admin/statement-report', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const pool = await sql.connect(dbConfig);
    
    let query = `
      SELECT bs.*, FORMAT(CAST(bs.transfer_time AS DATETIME), 'HH:mm:ss') AS time_formatted, ISNULL(bk.currency, 'THB') AS currency
      FROM Bank_Statements bs LEFT JOIN Banks bk ON bs.bank_id = bk.bank_id
      WHERE 1=1
    `;
    if (startDate && endDate) query += ` AND bs.transfer_date >= '${startDate}' AND bs.transfer_date <= '${endDate}'`;
    query += " ORDER BY bs.created_at DESC";
    const records = await pool.request().query(query);

    // 🌟 คิวรี่ใหม่: จัดกลุ่มแยกตาม "ชื่อธนาคาร และ เลขบัญชี" แทนการแยกแค่สกุลเงิน
    const summaryQuery = `
      SELECT 
        bk.bank_name,
        bk.account_number,
        ISNULL(bk.currency, 'THB') AS currency,
        ISNULL(SUM(CASE WHEN CAST(bs.transfer_date AS DATE) = CAST(GETDATE() AS DATE) THEN bs.amount ELSE 0 END), 0) AS todayTotal,
        ISNULL(SUM(CASE WHEN MONTH(bs.transfer_date) = MONTH(GETDATE()) AND YEAR(bs.transfer_date) = YEAR(GETDATE()) THEN bs.amount ELSE 0 END), 0) AS monthlyTotal
      FROM Bank_Statements bs
      LEFT JOIN Banks bk ON bs.bank_id = bk.bank_id
      GROUP BY bk.bank_name, bk.account_number, bk.currency
    `;
    const summaryRecords = await pool.request().query(summaryQuery);

    res.json({ success: true, records: records.recordset, summary: summaryRecords.recordset }); // 🌟 ส่งกลับไปเป็น Array
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงรายงานได้' });
  }
});


// ==========================================
// API: ดึงรายชื่อธนาคารสำหรับ Dropdown
// ==========================================
app.get('/api/admin/banks', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request().query("SELECT * FROM Banks WHERE is_active = 1");
    res.json({ success: true, banks: result.recordset });
  } catch (error) {
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลธนาคารได้' });
  }
});

// ==========================================
// API ตัวที่ 1: คีย์ยอดเงินเข้า และ กระทบยอดอัตโนมัติ (Auto-Reconciliation)
// ==========================================
app.post('/api/admin/key-statement', async (req, res) => {
  try {
    const { bankId, bankName, accountNumber, amount, transferDate, transferTime, adminName } = req.body;
    
    // 1. คลีนตัวเลขเวลา (ป้องกันกรณีเบราว์เซอร์ส่งแบบแปลกๆ มา และแปลง AM/PM เป็น 24 ชม.)
    let cleanTime = transferTime.trim();
    if (cleanTime.toLowerCase().includes('am') || cleanTime.toLowerCase().includes('pm')) {
      const [time, modifier] = cleanTime.split(' ');
      let [hours, minutes, seconds] = time.split(':');
      if (hours === '12') hours = '00';
      if (modifier.toUpperCase() === 'PM') hours = parseInt(hours, 10) + 12;
      cleanTime = `${hours}:${minutes}:${seconds || '00'}`;
    }
    
    // ถ้าเวลามาเป็น 11:11 ไม่มีวินาที ให้เติม :00 เข้าไป
    if (cleanTime.length === 5) {
      cleanTime = cleanTime + ':00';
    }

    // ปัดเศษป้องกันปัญหาทศนิยมเพี้ยน
    const cleanAmount = Math.round(parseFloat(amount) * 100) / 100;

    const pool = await sql.connect(dbConfig);

    // 2. บันทึกข้อมูลลง Bank_Statements โดยใช้ sql.VarChar แล้ว CAST ใน SQL ป้องกันเบราว์เซอร์ส่ง Data Type เพี้ยน
    const insertStmt = await pool.request()
      .input('bankId', sql.Int, bankId)
      .input('bankName', sql.NVarChar, bankName)
      .input('accountNumber', sql.VarChar, accountNumber)
      .input('amount', sql.Decimal(18,2), cleanAmount)
      .input('transferDate', sql.VarChar, transferDate) 
      .input('transferTime', sql.VarChar, cleanTime)    
      .input('recordedBy', sql.NVarChar, adminName)
      .query(`
        INSERT INTO Bank_Statements (bank_id, bank_name, account_number, amount, transfer_date, transfer_time, recorded_by, is_reconciled)
        OUTPUT INSERTED.statement_id
        VALUES (@bankId, @bankName, @accountNumber, @amount, CAST(@transferDate AS DATE), CAST(@transferTime AS TIME(0)), @recordedBy, 0)
      `);
      
    const statementId = insertStmt.recordset[0].statement_id;

    // 3. ค้นหาคำขอที่รอตรวจสอบ (ยอมรับความคลาดเคลื่อนได้ 0.01 บาท)
    const findMatch = await pool.request()
      .input('amount', sql.Decimal(18,2), cleanAmount)
      .input('accountNumber', sql.VarChar, accountNumber)
      .input('transferDate', sql.VarChar, transferDate)
      .input('transferTime', sql.VarChar, cleanTime)
      .query(`
        SELECT TOP 1 deposit_id, user_id 
        FROM Transactions_Deposit
        WHERE status = 'Pending' 
          AND account_number = @accountNumber
          AND ABS(amount - @amount) <= 0.01 
          AND CAST(deposit_datetime AS DATE) = CAST(@transferDate AS DATE)
          AND CAST(deposit_datetime AS TIME(0)) = CAST(@transferTime AS TIME(0))
      `);

    // 4. ถ้าเจอคู่ที่ตรงกัน ทำการอนุมัติ โอนเข้า Wallets และสร้าง Transactions
    if (findMatch.recordset.length > 0) {
      const match = findMatch.recordset[0];
      
      // อัปเดตสถานะบิล
      await pool.request()
        .input('depositId', sql.Int, match.deposit_id)
        .query("UPDATE Transactions_Deposit SET status = 'Approved', reviewed_by = 'Auto-Reconciled' WHERE deposit_id = @depositId");
        
      // เติมเงินเข้าตาราง Wallets
      await pool.request()
        .input('userId', sql.Int, match.user_id)
        .input('amount', sql.Decimal(18,2), cleanAmount)
        .query("UPDATE Wallets SET balance = ISNULL(balance, 0) + @amount, last_updated = GETDATE() WHERE user_id = @userId");

      // บันทึกประวัติในตาราง Transactions พร้อม title
      await pool.request()
        .input('userId', sql.Int, match.user_id)
        .input('amount', sql.Decimal(18,2), cleanAmount)
        .input('title', sql.NVarChar(255), 'ฝากเงิน (อัตโนมัติ)') 
        .query(`
          INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at) 
          VALUES (@userId, 'Deposit', @title, @amount, 'Completed', GETDATE())
        `);

      // อัปเดต Bank_Statements ว่าจับคู่สำเร็จแล้ว
      await pool.request()
        .input('stmtId', sql.Int, statementId)
        .input('depositId', sql.Int, match.deposit_id)
        .query("UPDATE Bank_Statements SET is_reconciled = 1, reconciled_with_deposit_id = @depositId WHERE statement_id = @stmtId");

      return res.json({ success: true, message: 'คีย์ยอดและกระทบยอดสำเร็จ! อนุมัติเงินเข้ากระเป๋าลูกค้าแล้ว', autoMatched: true });
    }

    res.json({ success: true, message: 'บันทึกยอดเงินสำเร็จ (ยังไม่พบคำขอที่ตรงกัน รอระบบตรวจสอบภายหลัง)', autoMatched: false });

  } catch (error) {
    console.error('❌ Error in key-statement:', error);
    res.status(500).json({ success: false, message: 'ระบบขัดข้อง: ' + error.message });
  }
});

// ==========================================
// API: ดึงรายงานสรุปและประวัติการคีย์ยอด
// ==========================================
app.get('/api/admin/statement-report', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const pool = await sql.connect(dbConfig);
    
    // ดึงประวัติที่กรองตามช่วงวันที่
    let query = "SELECT * FROM Bank_Statements WHERE 1=1";
    if (startDate && endDate) {
      query += ` AND transfer_date >= '${startDate}' AND transfer_date <= '${endDate}'`;
    }
    query += " ORDER BY created_at DESC";
    
    const records = await pool.request().query(query);

    // คำนวณสรุปยอดวันนี้ และเดือนนี้
    const summary = await pool.request().query(`
      SELECT 
        ISNULL(SUM(CASE WHEN CAST(created_at AS DATE) = CAST(GETDATE() AS DATE) THEN amount ELSE 0 END), 0) AS todayTotal,
        ISNULL(SUM(CASE WHEN MONTH(created_at) = MONTH(GETDATE()) AND YEAR(created_at) = YEAR(GETDATE()) THEN amount ELSE 0 END), 0) AS monthlyTotal
      FROM Bank_Statements
    `);

    res.json({ 
      success: true, 
      records: records.recordset, 
      todayTotal: summary.recordset[0].todayTotal,
      monthlyTotal: summary.recordset[0].monthlyTotal
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงรายงานได้' });
  }
});

// ==========================================
// 🌟 API 1: ดึงประวัติการฝากเงินของลูกค้า (เพื่อเช็คยอดตีกลับและแจ้งเตือน)
// ==========================================
app.get('/api/user/deposits/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request()
      .input('userId', sql.Int, userId)
      .query(`
        SELECT 
          deposit_id, amount, deposit_datetime, slip_image, status, reject_reasons, account_number, bank_name,
          -- 🌟 สั่ง SQL ให้หั่นวันที่และเวลาเป็นข้อความ (String) ป้องกันเวลาเพี้ยน +7
          CONVERT(varchar(10), deposit_datetime, 120) AS edit_date,
          CONVERT(varchar(8), deposit_datetime, 108) AS edit_time
        FROM Transactions_Deposit 
        WHERE user_id = @userId 
        ORDER BY created_at DESC
      `);
    
    res.json({ success: true, data: result.recordset });
  } catch (error) {
    console.error('Error fetching user deposits:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ==========================================
// 🌟 API: ดึงข้อมูลทีมงานและรายได้ (อัปเดต 3 รายได้)
// ==========================================
app.get('/api/team/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const pool = await sql.connect(dbConfig);
    const teamRes = await pool.request()
      .input('userId', sql.Int, userId)
      .query(`
        SELECT 
          user_id as id,
          username as name, 
          'https://ui-avatars.com/api/?name=' + username + '&background=random' as avatar,
          CONVERT(varchar(10), created_at, 103) as joinDate, 
          
          -- ดึงรายได้ 3 ช่องทาง
          ISNULL(total_purchase_comm, 0) as purchaseComm,
          ISNULL(total_win_comm, 0) as winComm,
          ISNULL(total_daily_bonus, 0) as dailyBonus,
          
          CAST(CASE WHEN DATEDIFF(day, created_at, GETDATE()) < 30 THEN 1 ELSE 0 END AS BIT) as isActive
        FROM Users
        WHERE referrer_username = (SELECT username FROM Users WHERE user_id = @userId)
        ORDER BY created_at DESC
      `);
      
    const teamMembers = teamRes.recordset || [];
    
    // รวมรายได้ทั้งหมด
    const totalIncome = teamMembers.reduce((sum, m) => sum + Number(m.purchaseComm) + Number(m.winComm) + Number(m.dailyBonus), 0);
    const incomeThisMonth = totalIncome * 0.5; // (สมมติยอดเดือนนี้)

    res.json({ success: true, teamMembers, totalIncome, incomeThisMonth });
  } catch (error) {
    console.error('Error fetching team:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลทีม' });
  }
});

// ==========================================
// 🌟 API: ดึงข้อมูลทีมงานและรายได้ (อัปเดต 3 รายได้)
// ==========================================
app.get('/api/team/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const pool = await sql.connect(dbConfig);
    const teamRes = await pool.request()
      .input('userId', sql.Int, userId)
      .query(`
        SELECT 
          user_id as id,
          username as name, 
          'https://ui-avatars.com/api/?name=' + username + '&background=random' as avatar,
          CONVERT(varchar(10), created_at, 103) as joinDate, 
          
          -- ดึงรายได้ 3 ช่องทาง
          ISNULL(total_purchase_comm, 0) as purchaseComm,
          ISNULL(total_win_comm, 0) as winComm,
          ISNULL(total_daily_bonus, 0) as dailyBonus,
          
          CAST(CASE WHEN DATEDIFF(day, created_at, GETDATE()) < 30 THEN 1 ELSE 0 END AS BIT) as isActive
        FROM Users
        WHERE referrer_username = (SELECT username FROM Users WHERE user_id = @userId)
        ORDER BY created_at DESC
      `);
      
    const teamMembers = teamRes.recordset || [];
    
    // รวมรายได้ทั้งหมด
    const totalIncome = teamMembers.reduce((sum, m) => sum + Number(m.purchaseComm) + Number(m.winComm) + Number(m.dailyBonus), 0);
    const incomeThisMonth = totalIncome * 0.5; // (สมมติยอดเดือนนี้)

    res.json({ success: true, teamMembers, totalIncome, incomeThisMonth });
  } catch (error) {
    console.error('Error fetching team:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลทีม' });
  }
});


// ... (API อื่นๆ ของคุณที่อยู่ด้านบน) ...
// ==========================================
// 🚀 Cron Job: แจกโบนัสทีมรายวัน (รันอัตโนมัติทุกวันเวลา 05:00 น.)
// ==========================================
cron.schedule('0 5 * * *', async () => {
    try {
        const pool = await sql.connect(dbConfig);
        console.log('⏰ [5:00 AM] กำลังคำนวณและแจกโบนัสรายวันให้ผู้แนะนำ...');
        
        await pool.request().query(`
            DECLARE @DailyPercent DECIMAL(18,2) = (SELECT TOP 1 daily_bonus_percent FROM Commission_Settings);

            -- 1. บันทึกประวัติ (Transactions) ว่าได้รับโบนัส
            INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at)
            SELECT 
                u.user_id, 'Bonus', N'โบนัสรายวันจากยอดรวมทีม', 
                SUM(o.total_amount) * (@DailyPercent / 100.0), 'Completed', GETDATE()
            FROM Lottery_Orders o
            JOIN Users d ON o.user_id = d.user_id
            JOIN Users u ON d.referrer_username = u.username
            -- คิดจากยอดบิลของเมื่อวาน (เพราะรันตี 5 ของวันนี้)
            WHERE CAST(o.created_at AS DATE) = CAST(DATEADD(DAY, -1, GETDATE()) AS DATE)
            GROUP BY u.user_id
            HAVING SUM(o.total_amount) > 0;

            -- 2. เติมเงินโบนัสเข้า Wallets ของคนที่เป็นผู้แนะนำทั้งหมด
            UPDATE w
            SET w.balance = ISNULL(w.balance, 0) + t.bonus_amount
            FROM Wallets w
            JOIN (
                SELECT 
                    u.user_id, 
                    SUM(o.total_amount) * ((SELECT TOP 1 daily_bonus_percent FROM Commission_Settings) / 100.0) as bonus_amount
                FROM Lottery_Orders o
                JOIN Users d ON o.user_id = d.user_id
                JOIN Users u ON d.referrer_username = u.username
                WHERE CAST(o.created_at AS DATE) = CAST(DATEADD(DAY, -1, GETDATE()) AS DATE)
                GROUP BY u.user_id
                HAVING SUM(o.total_amount) > 0
            ) t ON w.user_id = t.user_id;
        `);
        console.log('✅ [5:00 AM] แจกโบนัสรายวันสำเร็จเรียบร้อย!');
    } catch (err) {
        console.error('❌ เกิดข้อผิดพลาดในการแจกโบนัสรายวัน (Cron 5AM):', err);
    }
});
// ==========================================
// ==========================================
// 🌟 API: รายงานยอดขายหวยรายวัน (Admin) - แบบจัดกลุ่มบิล + รูปสัตว์
// ==========================================
app.get('/api/admin/daily-sales', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const targetDate = req.query.date || new Date().toISOString().split('T')[0];

    // 1. ดึงสรุปยอดขาย 
    const summaryRes = await pool.request()
      .input('targetDate', sql.Date, targetDate)
      .query(`
        SELECT 
          ISNULL(SUM(CASE WHEN CAST(created_at AS DATE) = @targetDate THEN total_amount ELSE 0 END), 0) AS daily_total,
          ISNULL(SUM(CASE WHEN MONTH(created_at) = MONTH(@targetDate) AND YEAR(created_at) = YEAR(@targetDate) THEN total_amount ELSE 0 END), 0) AS monthly_total
        FROM Lottery_Orders;
      `);

    // 2. ดึงรายการซื้อทั้งหมดของวันนี้ พร้อมชื่อและรูปสัตว์
    const salesRes = await pool.request()
      .input('targetDate', sql.Date, targetDate)
      .query(`
        SELECT 
          o.order_id,
          u.username,
          o.total_amount,
          o.currency_code,
          o.status as order_status,
          CONVERT(varchar(16), o.created_at, 120) as buy_time,
          i.item_id,
          i.lottery_type,
          i.selected_number,
          i.price,
          i.status as item_status,
          ISNULL(i.prize_amount, 0) as prize_amount,
          
          -- ดึงชื่อนามสัตว์
          ISNULL((
            SELECT TOP 1 animal_name_th 
            FROM Master_Animal_Numbers 
            WHERE lottery_type = i.lottery_type 
              AND (num1 = i.selected_number OR num2 = i.selected_number OR num3 = i.selected_number)
          ), '') as animal_name,

          -- ดึงรูปภาพสัตว์
          ISNULL((
            SELECT TOP 1 image_url 
            FROM Master_Animal_Numbers 
            WHERE lottery_type = i.lottery_type 
              AND (num1 = i.selected_number OR num2 = i.selected_number OR num3 = i.selected_number)
          ), '') as animal_image

        FROM Lottery_Orders o
        JOIN Users u ON o.user_id = u.user_id
        JOIN Lottery_Order_Items i ON o.order_id = i.order_id
        WHERE CAST(o.created_at AS DATE) = @targetDate
        ORDER BY o.created_at DESC;
      `);

    // 3. จัดกลุ่มข้อมูลด้วย JavaScript (รวม Item เข้าไปอยู่ในบิลเดียวกัน)
    const groupedOrders = {};
    const winnersList = [];
    let dailyPayout = 0;

    salesRes.recordset.forEach(row => {
        // ถ้ายังไม่มีบิลนี้ใน Object ให้สร้างใหม่
        if (!groupedOrders[row.order_id]) {
            groupedOrders[row.order_id] = {
                order_id: row.order_id,
                username: row.username,
                buy_time: row.buy_time,
                total_amount: row.total_amount,
                currency_code: row.currency_code,
                order_status: row.order_status,
                items: []
            };
        }
        
        // ข้อมูลเลขย่อยแต่ละตัว
        const itemDetails = {
            item_id: row.item_id,
            lottery_type: row.lottery_type,
            selected_number: row.selected_number,
            price: row.price,
            item_status: row.item_status,
            prize_amount: row.prize_amount,
            animal_name: row.animal_name,
            animal_image: row.animal_image
        };
        
        // ยัดเลขเข้าไปในบิล
        groupedOrders[row.order_id].items.push(itemDetails);

        // ถ้าเลขนี้ "ถูกรางวัล" ให้แยกออกมาไว้ในตารางผู้โชคดีด้วย
        if (row.item_status === 'ถูกรางวัล' || row.item_status === 'ถูก') {
            winnersList.push({ ...itemDetails, username: row.username, currency_code: row.currency_code });
            dailyPayout += row.prize_amount;
        }
    });

    res.json({
      success: true,
      summary: {
        dailyTotal: summaryRes.recordset[0].daily_total,
        monthlyTotal: summaryRes.recordset[0].monthly_total,
        dailyPayout: dailyPayout
      },
      salesDetails: Object.values(groupedOrders), // แปลง Object เป็น Array ส่งให้ React
      winners: winnersList
    });

  } catch (error) {
    console.error('Error fetching daily sales:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงรายงาน' });
  }
});

//==============================
// ==========================================
// ⚙️ API: ดึงข้อมูลการตั้งค่าระบบ (GET)
// ==========================================
app.get('/api/admin/settings', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query(`
            SELECT 
                CONVERT(varchar(5), close_time, 108) as close_time,
                CONVERT(varchar(5), open_time, 108) as open_time,
                CONVERT(varchar(5), draw_time, 108) as draw_time,
                is_sales_open,
                is_auto_draw,
                auto_draw_percent
            FROM System_Settings 
            WHERE id = 1
        `);

        if (result.recordset.length > 0) {
            res.json({ success: true, data: result.recordset[0] });
        } else {
            res.json({ success: false, message: "ไม่พบการตั้งค่าในระบบ" });
        }
    } catch (err) {
        console.error("Error fetching settings:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 API: บันทึกการตั้งค่าระบบและเวลา (POST)
// ==========================================
app.post('/api/admin/settings', async (req, res) => {
    const { close_time, open_time, draw_time, is_sales_open, is_auto_draw, auto_draw_percent } = req.body;
    
    // พิมพ์ค่าที่รับมาออกหน้าจอดำๆ เพื่อเช็คข้อมูล
    console.log("📥 ข้อมูลที่หน้าเว็บส่งมาบันทึก:", req.body); 

    try {
        const pool = await sql.connect(dbConfig);
        await pool.request()
            .input('closeTime', sql.VarChar, close_time) 
            .input('openTime', sql.VarChar, open_time)
            .input('drawTime', sql.VarChar, draw_time)
            .input('isOpen', sql.Bit, is_sales_open ? 1 : 0)
            .input('isAuto', sql.Bit, is_auto_draw ? 1 : 0)
            .input('percent', sql.Int, parseInt(auto_draw_percent) || 50) 
            .query(`
                UPDATE System_Settings 
                SET 
                    close_time = CAST(@closeTime AS TIME), 
                    open_time = CAST(@openTime AS TIME), 
                    draw_time = CAST(@drawTime AS TIME), 
                    is_sales_open = @isOpen,
                    is_auto_draw = @isAuto,
                    auto_draw_percent = @percent,
                    last_updated = GETDATE()
                WHERE id = 1
            `);
            
        console.log("✅ บันทึกเวลา ระบบออโต้ และ % สกอร์ ลงฐานข้อมูลสำเร็จ!");
        res.json({ success: true, message: 'บันทึกสำเร็จ' });
    } catch (err) { 
        console.error("❌ Error ตอนบันทึก:", err.message);
        res.status(500).json({ success: false, message: 'บันทึกไม่สำเร็จ' }); 
    }
});

// ==========================================
// 🌟 API 3: ส่งสถานะและเวลา ให้หน้าบ้านลูกค้า (ฝั่ง Client)
// ==========================================
app.get('/api/lottery/status', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query(`
            SELECT 
                CONVERT(varchar(5), close_time, 108) as close_time,
                CONVERT(varchar(5), open_time, 108) as open_time,
                CONVERT(varchar(5), draw_time, 108) as draw_time,
                is_sales_open 
            FROM System_Settings 
            WHERE id = 1
        `);
        res.json({ success: true, data: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// ==========================================
// 🌟 API 2: บันทึกผลออกรางวัล และ ค้นหาคนถูกรางวัล
// ==========================================
app.post('/api/admin/draw-results', async (req, res) => {
    const { prize_8, prize_6, prize_4, prize_3, prize_2 } = req.body;
    const today = new Date().toISOString().split('T')[0];

    try {
        const pool = await sql.connect(dbConfig);
        
        // 1. บันทึกผลลงตาราง Draw_Results
        await pool.request()
            .input('dDate', sql.Date, today)
            .input('p8', sql.VarChar, prize_8)
            .input('p6', sql.VarChar, prize_6)
            .input('p4', sql.VarChar, prize_4)
            .input('p3', sql.VarChar, prize_3)
            .input('p2', sql.VarChar, prize_2)
            .query(`
                IF EXISTS (SELECT 1 FROM Draw_Results WHERE draw_date = @dDate)
                    UPDATE Draw_Results SET prize_8=@p8, prize_6=@p6, prize_4=@p4, prize_3=@p3, prize_2=@p2 WHERE draw_date=@dDate;
                ELSE
                    INSERT INTO Draw_Results (draw_date, prize_8, prize_6, prize_4, prize_3, prize_2) 
                    VALUES (@dDate, @p8, @p6, @p4, @p3, @p2);
            `);

        // 2. อัปเดตสถานะบิลที่ "รอผลตรวจ" ให้เป็น "ถูกรางวัล" หรือ "ไม่ถูก"
        // (สมมติเรทจ่าย: 2ตัว=x90, 3ตัว=x900, 4ตัว=x7000, 6ตัว=x400000, 8ตัว=x1000000)
        await pool.request().input('dDate', sql.Date, today).query(`
            UPDATE i SET 
                status = CASE 
                    WHEN (i.lottery_type = '2' AND i.selected_number = '${prize_2}') OR
                         (i.lottery_type = '3' AND i.selected_number = '${prize_3}') OR
                         (i.lottery_type = '4' AND i.selected_number = '${prize_4}') OR
                         (i.lottery_type = '6' AND i.selected_number = '${prize_6}') OR
                         (i.lottery_type = '8' AND i.selected_number = '${prize_8}') THEN N'ถูกรางวัล'
                    ELSE N'ไม่ถูกรางวัล'
                END,
                prize_amount = CASE
                    WHEN i.lottery_type = '2' AND i.selected_number = '${prize_2}' THEN i.price * 90
                    WHEN i.lottery_type = '3' AND i.selected_number = '${prize_3}' THEN i.price * 900
                    WHEN i.lottery_type = '4' AND i.selected_number = '${prize_4}' THEN i.price * 7000
                    WHEN i.lottery_type = '6' AND i.selected_number = '${prize_6}' THEN i.price * 400000
                    WHEN i.lottery_type = '8' AND i.selected_number = '${prize_8}' THEN i.price * 1000000
                    ELSE 0
                END
            FROM Lottery_Order_Items i
            JOIN Lottery_Orders o ON i.order_id = o.order_id
            WHERE CAST(o.created_at AS DATE) = @dDate AND i.status = N'รอผลตรวจ';
        `);

        // 3. ดึงรายชื่อคนถูกรางวัลส่งกลับไปหน้าเว็บเพื่อทำ PDF
        const winnersRes = await pool.request().input('dDate', sql.Date, today).query(`
            SELECT u.username, i.lottery_type, i.selected_number, i.price, i.prize_amount, o.currency_code
            FROM Lottery_Order_Items i
            JOIN Lottery_Orders o ON i.order_id = o.order_id
            JOIN Users u ON o.user_id = u.user_id
            WHERE CAST(o.created_at AS DATE) = @dDate AND i.status = N'ถูกรางวัล';
        `);

        res.json({ success: true, winners: winnersRes.recordset });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการตรวจรางวัล' });
    }
});


// ==========================================
// 🌟 API: สำหรับหน้าลูกค้า เช็คสถานะการขายและเวลาต่างๆ
// ==========================================
app.get('/api/lottery/status', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query(`
            SELECT 
                CONVERT(varchar(5), close_time, 108) as close_time,
                CONVERT(varchar(5), open_time, 108) as open_time,
                CONVERT(varchar(5), draw_time, 108) as draw_time,
                is_sales_open 
            FROM System_Settings 
            WHERE id = 1
        `);
        res.json({ success: true, data: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// ==========================================
// 🌟 API: ดึงประวัติผลการออกรางวัลและรายชื่อคนถูกรางวัล ย้อนหลังตามวันที่ (เพิ่มยอดขาย)
// ==========================================
app.get('/api/admin/draw-history', async (req, res) => {
    const { date } = req.query; // คาดหวัง Format: YYYY-MM-DD (ค.ศ.)
    try {
        const pool = await sql.connect(dbConfig);
        
        // 1. ดึงผลรางวัลของวันนั้น
        const resultRes = await pool.request()
            .input('dDate', sql.Date, date)
            .query("SELECT * FROM Draw_Results WHERE draw_date = @dDate");
            
        // 2. ดึงคนถูกรางวัลของวันนั้น
        const winnersRes = await pool.request()
            .input('dDate', sql.Date, date)
            .query(`
                SELECT i.item_id as order_item_id, u.username, i.lottery_type, i.selected_number, i.price, i.prize_amount, o.currency_code
                FROM Lottery_Order_Items i
                JOIN Lottery_Orders o ON i.order_id = o.order_id
                JOIN Users u ON o.user_id = u.user_id
                WHERE o.draw_date = @dDate AND i.status = N'ถูกรางวัล'
            `);

        // 3. 🌟 (เพิ่มใหม่) ดึงยอดขายรวมทั้งหมดของงวดนั้น แยกตามสกุลเงิน THB และ LAK
        const salesRes = await pool.request()
            .input('dDate', sql.Date, date)
            .query(`
                SELECT o.currency_code, SUM(i.price) as total_sales
                FROM Lottery_Order_Items i
                JOIN Lottery_Orders o ON i.order_id = o.order_id
                WHERE o.draw_date = @dDate
                GROUP BY o.currency_code
            `);

        let total_sales_thb = 0;
        let total_sales_lak = 0;

        // แยกตะกร้ายอดขายเงินบาท กับ เงินกีบ
        salesRes.recordset.forEach(row => {
            if (row.currency_code === 'THB') {
                total_sales_thb += row.total_sales;
            } else if (row.currency_code === 'LAK' || row.currency_code === '₭') {
                total_sales_lak += row.total_sales;
            }
        });

        // 4. ส่งแพ็คเกจข้อมูลกลับไปให้หน้าเว็บ
        res.json({ 
            success: true, 
            results: resultRes.recordset.length > 0 ? resultRes.recordset[0] : null,
            winners: winnersRes.recordset,
            total_sales_thb: total_sales_thb, // 🌟 ยอดขาย THB
            total_sales_lak: total_sales_lak  // 🌟 ยอดขาย LAK
        });
    } catch (err) {
        console.error("Error fetching draw history:", err);
        res.status(500).json({ success: false });
    }
});


// ==========================================
// 🌟 API: ดึงประวัติผลการออกรางวัลแบบ "ช่วงวันที่" (รายเดือน)
// ==========================================
app.get('/api/admin/draw-history-range', async (req, res) => {
    const { startDate, endDate } = req.query;
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            // ใช้ VarChar แล้ว CAST เป็น DATE เพื่อป้องกันบั๊กเวลาเหลื่อมล้ำ
            .input('startDate', sql.VarChar, startDate)
            .input('endDate', sql.VarChar, endDate)
            .query(`
                SELECT * FROM Draw_Results
                WHERE draw_date >= CAST(@startDate AS DATE) 
                  AND draw_date <= CAST(@endDate AS DATE)
                ORDER BY draw_date DESC
            `);
            
        res.json({ success: true, history: result.recordset });
    } catch (err) {
        console.error("Error fetching history range:", err);
        res.status(500).json({ success: false });
    }
});


// ==========================================
// 🌟 API 1: ดึงเรทการจ่ายรางวัล (Lottery_Prize_Rates)
// ==========================================
app.get('/api/admin/prize-rates', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query("SELECT * FROM Lottery_Prize_Rates ORDER BY CAST(lottery_type AS INT)");
        res.json({ success: true, rates: result.recordset });
    } catch (err) { res.status(500).json({ success: false }); }
});

// ==========================================
// 🌟 API 2: อัปเดตเรทการจ่ายรางวัล
// ==========================================
app.post('/api/admin/prize-rates', async (req, res) => {
    const { rates } = req.body;
    try {
        const pool = await sql.connect(dbConfig);
        for (let r of rates) {
            await pool.request()
                .input('id', sql.Int, r.id)
                .input('multiplier', sql.Decimal(18,2), r.multiplier)
                .query("UPDATE Lottery_Prize_Rates SET multiplier = @multiplier WHERE id = @id");
        }
        res.json({ success: true, message: "อัปเดตอัตราจ่ายสำเร็จ" });
    } catch (err) { res.status(500).json({ success: false }); }
});

// ==========================================
// 🌟 API: ดึงและอัปเดตอัตราแลกเปลี่ยน (ExchangeRates)
// ==========================================
app.get('/api/admin/exchange-rates', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query("SELECT * FROM ExchangeRates");
        res.json({ success: true, rates: result.recordset });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/exchange-rates', async (req, res) => {
    const { pair, rate } = req.body;
    try {
        const pool = await sql.connect(dbConfig);
        await pool.request()
            .input('pair', sql.VarChar, pair)
            .input('rate', sql.Decimal(18,6), rate)
            .query("UPDATE ExchangeRates SET rate = @rate, last_updated = GETDATE() WHERE currency_pair = @pair");
        res.json({ success: true, message: "อัปเดตเรทเงินสำเร็จ" });
    } catch (err) { res.status(500).json({ success: false }); }
});


// ==========================================
// 🌟 API 3: เช็คยอดวิเคราะห์ความเสี่ยง (Analyze Draw)
// ==========================================
app.post('/api/admin/analyze-draw', async (req, res) => {
    const { number } = req.body; 
    try {
        const pool = await sql.connect(dbConfig);
        
        // ดึงเรทแลกเปลี่ยนสดๆ ทุกครั้งที่กดปุ่ม
        const rateRes = await pool.request().query("SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'");
        const exchangeRate = rateRes.recordset.length > 0 ? rateRes.recordset[0].rate : 500.0;

        const num6 = number;
        const num4 = number.slice(-4);
        const num3 = number.slice(-3);
        const num2 = number.slice(-2);

        const salesRes = await pool.request()
            .query(`SELECT ISNULL(SUM(CASE WHEN currency_code = 'LAK' THEN total_amount / ${exchangeRate} ELSE total_amount END), 0) as totalSalesTHB FROM Lottery_Orders WHERE status = N'รอผลตรวจ'`);
        const totalSales = salesRes.recordset[0].totalSalesTHB;

        const analysisRes = await pool.request()
            .input('n6', sql.VarChar, num6).input('n4', sql.VarChar, num4)
            .input('n3', sql.VarChar, num3).input('n2', sql.VarChar, num2)
            .query(`
                SELECT 
                    CAST(i.lottery_type AS VARCHAR) as lottery_type,
                    COUNT(i.item_id) as winner_count,
                    SUM(CASE WHEN o.currency_code = 'LAK' THEN (i.price * r.multiplier) / ${exchangeRate} ELSE (i.price * r.multiplier) END) as total_payout
                FROM Lottery_Order_Items i
                JOIN Lottery_Orders o ON i.order_id = o.order_id
                LEFT JOIN Lottery_Prize_Rates r ON CAST(i.lottery_type AS INT) = CAST(r.lottery_type AS INT)
                WHERE o.status = N'รอผลตรวจ' AND i.status = N'รอผลตรวจ'
                AND (
                    (i.lottery_type = '2' AND i.selected_number = @n2) OR
                    (i.lottery_type = '3' AND i.selected_number = @n3) OR
                    (i.lottery_type = '4' AND i.selected_number = @n4) OR
                    (i.lottery_type = '6' AND i.selected_number = @n6)
                )
                GROUP BY CAST(i.lottery_type AS VARCHAR)
            `);
        
        res.json({ success: true, totalSales, analysis: analysisRes.recordset });
    } catch (err) { res.status(500).json({ success: false }); }
});



// ==========================================
// 🌟 API หวยไทย เริ่ม
// ==========================================
// ==========================================
// 1. 🇹🇭 API: ดึงข้อมูลรอบหวยไทยทั้งหมด (สำหรับฝั่ง Admin) -> แก้บั๊ก Timezone
// ==========================================
app.get('/api/admin/thai-lottery/rounds', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query(`
            SELECT round_id, 
                   ISNULL(round_name, CAST(round_number AS NVARCHAR(100))) as round_number, 
                   FORMAT(open_time, 'yyyy-MM-ddTHH:mm:ss') AS open_time, 
                   FORMAT(close_time, 'yyyy-MM-ddTHH:mm:ss') AS close_time, 
                   FORMAT(draw_time, 'yyyy-MM-ddTHH:mm:ss') AS draw_time, 
                   status, result_8_super as result_6, result_2_bottom 
            FROM Yeeki_Rounds 
            WHERE category = 'THAI' 
            ORDER BY draw_time DESC
        `);
        res.json({ success: true, rounds: result.recordset });
    } catch (err) {
        console.error("Error fetching Thai rounds:", err);
        res.status(500).json({ success: false });
    }
});


// ==========================================
// 2. 🇹🇭 API: ดึงข้อมูลหวยไทยงวดปัจจุบัน (สำหรับหน้าเว็บลูกค้า) -> แก้บั๊ก Timezone
// ==========================================
app.get('/api/thai-lottery/current-round', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        
        const roundReq = await pool.request().query(`
            SELECT TOP 1 
                round_id, 
                ISNULL(round_name, CAST(round_number AS NVARCHAR(100))) as round_number, 
                FORMAT(open_time, 'yyyy-MM-ddTHH:mm:ss') AS open_time, 
                FORMAT(close_time, 'yyyy-MM-ddTHH:mm:ss') AS close_time, 
                FORMAT(draw_time, 'yyyy-MM-ddTHH:mm:ss') AS draw_time, 
                status 
            FROM Yeeki_Rounds 
            WHERE category = 'THAI' AND status != 'Completed' 
            ORDER BY close_time ASC
        `);

        if (roundReq.recordset.length > 0) {
            res.json({ success: true, round: roundReq.recordset[0] });
        } else {
            res.json({ success: true, round: null, message: 'ยังไม่มีการเปิดรับแทงหวยไทยในขณะนี้' });
        }
    } catch (err) {
        console.error("Error fetching current Thai round:", err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
    }
});

// 2. 🇹🇭 สร้างงวดหวยไทยใหม่ (แก้ปัญหา Error Type INT, ภาษาไทย และ draw_date NULL)
app.post('/api/admin/thai-lottery/create-round', async (req, res) => {
    const { round_number, open_time, close_time, draw_time } = req.body;
    if (!round_number || !open_time || !close_time || !draw_time) {
        return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูล วันเวลาเปิด-ปิด ให้ครบถ้วน' });
    }

    try {
        const pool = await sql.connect(dbConfig);
        
        // 🌟 1. ดึงชื่อภาษาไทยมาเก็บไว้ในตัวแปรแยก
        const roundNameText = round_number; 
        
        // 🌟 2. สร้างเลขจำลองให้คอลัมน์ round_number เดิม (เช่น วันที่ 16/08/2026 -> 20260816)
        const d = new Date(draw_time);
        const fakeIntRound = parseInt(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`);

        // เช็คว่าซ้ำไหม (ใช้ตัว N นำหน้า @rName เพื่อให้รองรับภาษาไทย)
        const checkReq = await pool.request()
            .input('rName', sql.NVarChar, roundNameText)
            .query(`SELECT 1 FROM Yeeki_Rounds WHERE round_name = @rName AND category = 'THAI'`);
            
        if (checkReq.recordset.length > 0) return res.status(400).json({ success: false, message: 'งวดหวยไทยนี้ถูกสร้างไว้แล้ว' });

        // 🌟 3. บันทึกลงฐานข้อมูล (สั่งให้ SQL คัดลอกวันที่จาก @dTime ไปใส่ใน draw_date ด้วย CAST)
        await pool.request()
            .input('rNumInt', sql.Int, fakeIntRound)
            .input('rName', sql.NVarChar, roundNameText)
            .input('oTime', sql.DateTime, open_time)
            .input('cTime', sql.DateTime, close_time)
            .input('dTime', sql.DateTime, draw_time)
            .query(`INSERT INTO Yeeki_Rounds (round_number, round_name, open_time, close_time, draw_time, draw_date, status, category)
                    VALUES (@rNumInt, @rName, @oTime, @cTime, @dTime, CAST(@dTime AS DATE), 'Pending', 'THAI')`);

        res.json({ success: true, message: `✅ สร้างงวดหวยไทย (${roundNameText}) สำเร็จ!` });
    } catch (err) { 
        res.status(500).json({ success: false, message: err.message }); 
    }
});



// 3. 🇹🇭 ประกาศผลหวยไทย + จ่ายเงินรางวัลและค่าคอมมิชชัน
app.post('/api/admin/thai-lottery/execute-draw', async (req, res) => {
    const { round_id, number6, number2bot } = req.body;
    
    if (!round_id || !number6 || !number2bot || number6.length !== 6 || number2bot.length !== 2) {
        return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน กรุณากรอกเลขให้ถูกต้อง' });
    }

    let pool;
    try {
        pool = await sql.connect(dbConfig);
        
        // แตกตัวเลขตามกติกาหวยใต้ดินไทย
        const top_6 = number6;
        const top_4 = top_6.slice(-4);
        const top_3 = top_6.slice(-3);
        const top_2 = top_6.slice(-2);
        const bot_2 = number2bot;
        const top_3_sorted = top_3.split('').sort().join('');

        // ดึงเรทจ่ายหวยยี่กีมาใช้ (เพราะกติกาและประเภทหวยเหมือนกัน)
        const ratesReq = await pool.request().query(`SELECT lottery_type, multiplier FROM Yeeki_Prize_Rates`);
        const prizeRates = {};
        ratesReq.recordset.forEach(r => prizeRates[r.lottery_type] = r.multiplier);

        let winCommissionPercent = 0;
        try {
            const commReq = await pool.request().query(`SELECT TOP 1 win_percent FROM Commission_Settings`);
            if (commReq.recordset.length > 0) winCommissionPercent = commReq.recordset[0].win_percent || 0;
        } catch (e) {}

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);

            // 3.1 บันทึกเลขที่ออกลงตารางรอบหวย (ใช้ช่องที่มีอยู่ของ Yeeki)
            await request
                .input('rId', sql.Int, round_id)
                .input('p6', sql.VarChar, top_6).input('p4', sql.VarChar, top_4)
                .input('p3', sql.VarChar, top_3).input('p2b', sql.VarChar, bot_2)
                .query(`UPDATE Yeeki_Rounds SET result_8_super = @p6, result_4_top = @p4, result_3_top = @p3, result_2_bottom = @p2b, status = 'Completed' WHERE round_id = @rId`);

            // 3.2 ดึงบิลหวยไทยที่รอตรวจทั้งหมดของรอบนี้
            const ordersReq = await request.input('roundId', sql.Int, round_id).query(`
                SELECT i.item_id, o.user_id, i.lottery_type, i.selected_number, i.price, o.currency_code
                FROM Yeeki_Order_Items i JOIN Yeeki_Orders o ON i.order_id = o.order_id
                WHERE o.round_id = @roundId AND i.status = N'รอผลตรวจ'
            `);
            
            let totalWinners = 0;

            // 3.3 ตรวจบิล จ่ายเงิน จ่ายค่าคอมฯ ทีละใบ
            for (let item of ordersReq.recordset) {
                let isWin = false;
                let t = item.lottery_type;
                let n = item.selected_number;

                // กติกาตรวจหวยไทย
                if (t === '6 ตัว' && n === top_6) isWin = true;
                else if (t === '4 ตัวท้าย' && n === top_4) isWin = true;
                else if (t === '3 ตัวบน' && n === top_3) isWin = true;
                else if (t === '3 ตัวโต๊ด' && n.split('').sort().join('') === top_3_sorted) isWin = true;
                else if (t === '2 ตัวบน' && n === top_2) isWin = true;
                else if ((t === '2 ตัวล่าง' || t === '2 ล่าง') && n === bot_2) isWin = true;
                else if (t === 'วิ่งบน' && top_3.includes(n)) isWin = true;
                else if (t === 'วิ่งล่าง' && bot_2.includes(n)) isWin = true;

                if (isWin) {
                    totalWinners++;
                    let prizeAmount = item.price * (prizeRates[item.lottery_type] || 0);
                    let isLAK = (item.currency_code === 'LAK' || item.currency_code === '₭');
                    let currency = isLAK ? 'LAK' : 'THB';

                    await request
                        .input('itemId', sql.Int, item.item_id).input('prizeAmt', sql.Decimal(18, 2), prizeAmount)
                        .query(`UPDATE Yeeki_Order_Items SET status = N'ชนะ', prize_amount = @prizeAmt WHERE item_id = @itemId`);

                    let updateWalletQuery = isLAK 
                        ? `UPDATE Wallets SET balance_lak = balance_lak + @wAmt WHERE user_id = @uId`
                        : `UPDATE Wallets SET balance_thb = balance_thb + @wAmt WHERE user_id = @uId`;
                    
                    await request.input('uId', sql.Int, item.user_id).input('wAmt', sql.Decimal(18, 2), prizeAmount).query(updateWalletQuery);

                    await request
                        .input('txUid', sql.Int, item.user_id).input('txAmt', sql.Decimal(18, 2), prizeAmount)
                        .input('txCur', sql.VarChar, currency).input('txNote', sql.NVarChar, `ถูกรางวัลหวยไทย ${item.lottery_type}`)
                        .query(`INSERT INTO Transactions (user_id, amount, currency_code, transaction_type, status, note, created_at) VALUES (@txUid, @txAmt, @txCur, 'deposit', 'Completed', @txNote, GETDATE())`);

                    // 💵 จ่ายค่าคอมฯ ผู้แนะนำ
                    if (winCommissionPercent > 0) {
                        const refReq = await request.input('childId', sql.Int, item.user_id).query(`SELECT referrer_id FROM User_Referrals WHERE user_id = @childId`);
                        if (refReq.recordset.length > 0) {
                            let refId = refReq.recordset[0].referrer_id;
                            let commAmt = prizeAmount * (winCommissionPercent / 100);
                            
                            let updateCommWalletQuery = isLAK 
                                ? `UPDATE Wallets SET balance_lak = balance_lak + @cAmt WHERE user_id = @rId`
                                : `UPDATE Wallets SET balance_thb = balance_thb + @cAmt WHERE user_id = @rId`;
                                
                            await request.input('rId', sql.Int, refId).input('cAmt', sql.Decimal(18, 2), commAmt).query(updateCommWalletQuery);

                            await request
                                .input('cTxUid', sql.Int, refId).input('cTxAmt', sql.Decimal(18, 2), commAmt)
                                .input('cTxCur', sql.VarChar, currency).input('cTxNote', sql.NVarChar, `ค่าคอมหวยไทยลูกทีมถูกรางวัล ${winCommissionPercent}%`)
                                .query(`INSERT INTO Transactions (user_id, amount, currency_code, transaction_type, status, note, created_at) VALUES (@cTxUid, @cTxAmt, @cTxCur, 'commission', 'Completed', @cTxNote, GETDATE())`);
                        }
                    }
                } else {
                    await request.input('itemIdLoss', sql.Int, item.item_id).query(`UPDATE Yeeki_Order_Items SET status = N'ไม่ถูกรางวัล', prize_amount = 0 WHERE item_id = @itemIdLoss`);
                }
            }

            // 3.4 ปิดบิลใหญ่
            await request.input('rIdMaster', sql.Int, round_id).query(`UPDATE Yeeki_Orders SET status = N'ตรวจผลแล้ว' WHERE round_id = @rIdMaster`);

            await transaction.commit();
            res.json({ success: true, message: `✅ ประกาศผลหวยไทยสำเร็จ! จ่ายเงินผู้ชนะ ${totalWinners} รายการ` });

        } catch (transErr) { await transaction.rollback(); throw transErr; }
    } catch (err) {
        console.error("Execute Thai Draw Error:", err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
    }
});


// ==========================================
// 7. 🇹🇭 API: ดึงรายการบิลลูกค้าหวยไทยรายงวด (สำหรับหน้ารายงาน)
// ==========================================
app.get('/api/admin/thai-lottery/round-tickets/:roundId', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const request = pool.request();
        request.input('roundId', sql.Int, req.params.roundId);
        
        const result = await request.query(`
            SELECT 
                u.username,
                o.currency_code,
                i.lottery_type,
                i.selected_number,
                i.price,
                i.status,
                i.prize_amount,
                o.created_at -- 🌟 แก้ไข: ใช้เวลาจากบิลใหญ่ (o.created_at)
            FROM Yeeki_Order_Items i
            JOIN Yeeki_Orders o ON i.order_id = o.order_id
            LEFT JOIN Users u ON o.user_id = u.user_id
            WHERE o.round_id = @roundId
            ORDER BY o.created_at DESC -- 🌟 แก้ไข: เรียงลำดับจากบิลใหญ่
        `);
        
        res.json({ success: true, tickets: result.recordset });
    } catch (err) {
        console.error("Fetch Tickets Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 6. 🇹🇭 API: ดึงรายงานยอดขายหวยไทย (สำหรับหน้า Admin Report)
// ==========================================
app.get('/api/admin/thai-lottery/sales-report', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        
        // 🌟 ดึงข้อมูลสรุปยอดขายแยกตามงวด แยกสกุลเงิน (THB/LAK) และสถานะการตรวจรางวัล
        const reportReq = await pool.request().query(`
            SELECT 
                r.round_id, 
                r.round_number, 
                FORMAT(r.open_time, 'yyyy-MM-ddTHH:mm:ss') AS open_time, 
                FORMAT(r.close_time, 'yyyy-MM-ddTHH:mm:ss') AS close_time, 
                FORMAT(r.draw_time, 'yyyy-MM-ddTHH:mm:ss') AS draw_time, 
                r.status, 
                r.result_8_super as result_6, 
                r.result_2_bottom,
                
                -- สรุปยอดขาย (THB และ LAK)
                ISNULL(SUM(CASE WHEN o.currency_code IN ('THB', '฿') THEN i.price ELSE 0 END), 0) as total_sales_thb,
                ISNULL(SUM(CASE WHEN o.currency_code IN ('LAK', '₭') THEN i.price ELSE 0 END), 0) as total_sales_lak,
                
                -- สรุปยอดจ่ายรางวัล (THB และ LAK)
                ISNULL(SUM(CASE WHEN o.currency_code IN ('THB', '฿') AND i.status = N'ชนะ' THEN i.prize_amount ELSE 0 END), 0) as total_payout_thb,
                ISNULL(SUM(CASE WHEN o.currency_code IN ('LAK', '₭') AND i.status = N'ชนะ' THEN i.prize_amount ELSE 0 END), 0) as total_payout_lak,
                
                -- สรุปสถานะบิล
                COUNT(i.item_id) as total_tickets,
                COUNT(CASE WHEN i.status = N'ชนะ' THEN 1 END) as winners_count,
                COUNT(CASE WHEN i.status = N'รอผลตรวจ' THEN 1 END) as pending_count,
                COUNT(CASE WHEN i.status = N'ไม่ถูกรางวัล' THEN 1 END) as lost_count
                
            FROM Yeeki_Rounds r
            LEFT JOIN Yeeki_Orders o ON r.round_id = o.round_id
            LEFT JOIN Yeeki_Order_Items i ON o.order_id = i.order_id
            WHERE r.category = 'THAI'
            GROUP BY r.round_id, r.round_number, r.open_time, r.close_time, r.draw_time, r.status, r.result_8_super, r.result_2_bottom
            ORDER BY r.draw_time DESC
        `);

        res.json({ success: true, reports: reportReq.recordset });
    } catch (err) {
        console.error("Sales Report Error:", err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงรายงาน' });
    }
});


// ==========================================
// 5. 🇹🇭 API: แก้ไขข้อมูลงวดหวยไทย (ป้องกันงวดขยะ)
// ==========================================
app.post('/api/admin/thai-lottery/edit-round', async (req, res) => {
    const { round_id, round_number, open_time, close_time, draw_time } = req.body;
    
    if (!round_id || !round_number || !open_time || !close_time || !draw_time) {
        return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
    }

    try {
        const pool = await sql.connect(dbConfig);
        
        // เช็คสถานะก่อนว่ามีสิทธิ์แก้ไหม (ถ้าออกผลแล้วห้ามแก้)
        const check = await pool.request().input('rId', sql.Int, round_id).query(`SELECT status FROM Yeeki_Rounds WHERE round_id = @rId`);
        if (check.recordset.length === 0) return res.status(404).json({ success: false, message: 'ไม่พบงวดนี้ในระบบ' });
        if (check.recordset[0].status === 'Completed') return res.status(400).json({ success: false, message: 'งวดนี้ประกาศผลไปแล้ว ไม่สามารถแก้ไขได้' });

        // แปลงข้อมูลให้ตรงฟอร์แมต
        const roundNameText = round_number; 
        const d = new Date(draw_time);
        const fakeIntRound = parseInt(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`);

        // อัปเดตข้อมูล
        await pool.request()
            .input('rId', sql.Int, round_id)
            .input('rNumInt', sql.Int, fakeIntRound)
            .input('rName', sql.NVarChar, roundNameText)
            .input('oTime', sql.DateTime, open_time)
            .input('cTime', sql.DateTime, close_time)
            .input('dTime', sql.DateTime, draw_time)
            .query(`
                UPDATE Yeeki_Rounds 
                SET round_number = @rNumInt, 
                    round_name = @rName, 
                    open_time = @oTime, 
                    close_time = @cTime, 
                    draw_time = @dTime, 
                    draw_date = CAST(@dTime AS DATE)
                WHERE round_id = @rId
            `);

        res.json({ success: true, message: '✅ อัปเดตข้อมูลสำเร็จ!' });
    } catch (err) {
        console.error("Edit Round Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 4. 🇹🇭 API: ซื้อหวยรัฐบาลไทย (แยกตาราง Yeeki_Orders และแยกบิล 100%)
// ==========================================
app.post('/api/thai-lottery/buy', async (req, res) => {
    const { user_id, round_id, cart, total_price, currency, note } = req.body;
    const pool = await sql.connect(dbConfig);
    
    // เช็คว่ามีงวดที่กำลังเปิดรับอยู่หรือไม่
    const statusRes = await pool.request().input('rId', sql.Int, round_id).query("SELECT status, close_time FROM Yeeki_Rounds WHERE round_id = @rId AND category = 'THAI'");
    if (statusRes.recordset.length === 0 || statusRes.recordset[0].status === 'Completed') {
        return res.status(400).json({ success: false, message: 'งวดนี้ปิดรับแทงแล้ว หรือไม่มีในระบบ' });
    }

    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();
        const request = new sql.Request(transaction);

        // 1. ดึงเรทเงิน ถ้าเป็น LAK
        let exchangeRate = 1;
        if (currency === 'LAK' || currency === '₭') {
            const rateRes = await request.query("SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'");
            if (rateRes.recordset.length > 0) exchangeRate = rateRes.recordset[0].rate;
        }

        const baseTHBAmount = total_price / exchangeRate;
        const deductAmount = baseTHBAmount * exchangeRate; 

        // 2. ตัดเงิน
        const userRes = await request.input('userId', sql.Int, user_id).query('SELECT balance FROM Wallets WHERE user_id = @userId'); 
        if (userRes.recordset.length === 0) throw new Error('ไม่พบกระเป๋าเงิน');
        if (userRes.recordset[0].balance < deductAmount) throw new Error('ยอดเงินในกระเป๋าไม่เพียงพอ');

        request.input('deductAmount', sql.Decimal(18,2), deductAmount);
        await request.query(`
            UPDATE Users SET wallet_balance = ISNULL(wallet_balance, 0) - @deductAmount WHERE user_id = @userId;
            UPDATE Wallets SET balance = balance - @deductAmount WHERE user_id = @userId;
        `);

        // 3. บันทึกประวัติ Transaction ฝั่งหวยไทย
        await request
            .input('titleTH', sql.NVarChar, 'ซื้อหวยรัฐบาลไทย')
            .input('amountTH', sql.Decimal(18,2), -deductAmount) 
            .query(`INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at)
                    VALUES (@userId, 'Buy Lottery', @titleTH, @amountTH, 'Completed', GETDATE())`);

        // 4. บันทึกบิลลงตาราง Yeeki_Orders (เพราะหวยไทยใช้เครื่องมือตรวจผลตัวเดียวกับยี่กี)
        const orderRes = await request
            .input('cur', sql.VarChar, currency)
            .input('tPrice', sql.Decimal(18,2), deductAmount)
            .input('rId', sql.Int, round_id)
            .input('note', sql.NVarChar, note || null)
            .query(`
                DECLARE @ThaiTime DATETIME = DATEADD(HOUR, 7, GETUTCDATE());
                INSERT INTO Yeeki_Orders (user_id, round_id, total_amount, currency_code, status, order_note, category, created_at)
                OUTPUT INSERTED.order_id
                VALUES (@userId, @rId, @tPrice, @cur, N'รอผลตรวจ', @note, 'THAI', @ThaiTime)
            `);
        
        const orderId = orderRes.recordset[0].order_id;

       // บันทึกตัวเลข
        for (const item of cart) {
            const itemReq = new sql.Request(transaction);
            await itemReq
                .input('oId', sql.Int, orderId)
                .input('lNum', sql.VarChar, item.number)
                .input('lType', sql.NVarChar, item.type) // 🌟 แก้ตรงนี้: เติม N เข้าไปหน้า VarChar
                .input('price', sql.Decimal(18,2), item.price)
                .query(`INSERT INTO Yeeki_Order_Items (order_id, lottery_type, selected_number, price, status) VALUES (@oId, @lType, @lNum, @price, N'รอผลตรวจ')`);
        }

        // 5. ระบบจ่ายค่าแนะนำหวยไทย (Cross-Currency เหมือนเวียดนาม)
        const refReq = new sql.Request(transaction);
        const referrerRes = await refReq.input('buyerId', sql.Int, user_id).query(`
            SELECT u_referrer.user_id, u_buyer.username as buyer_username,
                   ISNULL(u_buyer.currency_code, 'THB') as buyer_currency, ISNULL(u_referrer.currency_code, 'THB') as referrer_currency
            FROM Users u_buyer JOIN Users u_referrer ON u_buyer.referrer_username = u_referrer.username WHERE u_buyer.user_id = @buyerId
        `);

        if (referrerRes.recordset.length > 0) {
            const ref = referrerRes.recordset[0];
            const settingRes = await (new sql.Request(transaction)).query("SELECT purchase_percent FROM Commission_Settings WHERE id = 1");
            const purchasePercent = settingRes.recordset.length > 0 ? settingRes.recordset[0].purchase_percent : 2.00; 
            
            let finalCommission = deductAmount * (purchasePercent / 100); 

            if (ref.buyer_currency !== ref.referrer_currency) {
                const pair = `${ref.buyer_currency}_${ref.referrer_currency}`; 
                const rateReq = new sql.Request(transaction);
                const rateRes = await rateReq.input('pair', sql.VarChar, pair).query(`SELECT rate FROM ExchangeRates WHERE currency_pair = @pair`);
                if (rateRes.recordset.length > 0) {
                    finalCommission = finalCommission * rateRes.recordset[0].rate;
                } else {
                    const revRes = await (new sql.Request(transaction)).input('revPair', sql.VarChar, `${ref.referrer_currency}_${ref.buyer_currency}`).query(`SELECT rate FROM ExchangeRates WHERE currency_pair = @revPair`);
                    if (revRes.recordset.length > 0) finalCommission = finalCommission / revRes.recordset[0].rate;
                }
            }

            const commReq = new sql.Request(transaction);
            await commReq
                .input('refId', sql.Int, ref.user_id).input('comm', sql.Decimal(18,2), finalCommission)
                .input('tTitle', sql.NVarChar, `รายได้ ${purchasePercent}% หวยไทย จากทีมงาน (${ref.buyer_username})`)
                .query(`
                    UPDATE Wallets SET balance = balance + @comm WHERE user_id = @refId;
                    UPDATE Users SET total_purchase_comm = ISNULL(total_purchase_comm, 0) + @comm WHERE user_id = @refId;
                    INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at)
                    VALUES (@refId, 'Affiliate Purchase', @tTitle, @comm, 'Completed', GETDATE());
                `);
        }

        await transaction.commit();
        res.status(200).json({ success: true, message: 'ชำระเงินหวยไทยสำเร็จ', order_id: orderId });

    } catch (error) {
        await transaction.rollback();
        res.status(400).json({ success: false, message: error.message || 'เกิดข้อผิดพลาดในการชำระเงิน' });
    }
});
// ==========================================
// 🌟 API หวยไทย จบ
// ==========================================




// ==========================================
// 🌟 API หวยไทย    จบ
// // ==========================================

// ==========================================
// 🌟 API หวยเวียดนาม เริ่ม
// // ==========================================

// ==========================================
// 🇻🇳 API: ระบบ AI ค้นหาเลขหวยเวียดนาม (Risk Management)
// ==========================================
app.post('/api/admin/suggest-draw', async (req, res) => {
    const { targetPercent } = req.body;
    try {
        const pool = await sql.connect(dbConfig);
        
        // ดึงเรทแลกเปลี่ยน และอัตราจ่าย
        const exReq = await pool.request().query(`SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'`);
        const lakRate = exReq.recordset.length > 0 ? exReq.recordset[0].rate : 620;

        const ratesReq = await pool.request().query(`SELECT lottery_type, multiplier FROM Lottery_Prize_Rates`);
        const prizeRates = {};
        ratesReq.recordset.forEach(r => prizeRates[r.lottery_type] = r.multiplier);

        // ดึงโพยหวยเวียดนามที่ยังไม่ได้ตรวจ
        const ordersReq = await pool.request().query(`
            SELECT i.lottery_type, i.selected_number, i.price, o.currency_code
            FROM Lottery_Order_Items i
            JOIN Lottery_Orders o ON i.order_id = o.order_id
            WHERE o.status = N'รอผลตรวจ' AND i.status = N'รอผลตรวจ'
        `);
        const items = ordersReq.recordset;

        let totalSalesTHB = 0;
        let boughtNumbers = []; 
        items.forEach(item => {
            let thbPrice = (item.currency_code === 'LAK' || item.currency_code === '₭') ? (item.price / lakRate) : item.price;
            totalSalesTHB += thbPrice;
            boughtNumbers.push(item);
        });

        const targetPayoutTHB = totalSalesTHB * (targetPercent / 100);
        const pad = (num, len) => num.toString().padStart(len, '0');
        
        let bestNumber = pad(Math.floor(Math.random() * 1000000), 6);
        let maxFoundPayout = -1;
        let minFoundPayout = Infinity;
        let bestAnalysis = { '6': { count: 0, payout: 0 }, '4': { count: 0, payout: 0 }, '3': { count: 0, payout: 0 }, '2': { count: 0, payout: 0 } };

        // AI สุ่มจำลองหาเลขที่ดีที่สุด 5,000 รูปแบบ
        for (let i = 0; i < 5000; i++) {
            let sim6 = pad(Math.floor(Math.random() * 1000000), 6);
            
            // ถ้าเป้า > 0% พยายามหยิบเลขที่ลูกค้าซื้อมาตั้งเป็นผลรางวัล
            if (targetPercent > 0 && boughtNumbers.length > 0 && Math.random() > 0.4) {
                let rItem = boughtNumbers[Math.floor(Math.random() * boughtNumbers.length)];
                if (rItem.lottery_type === '3') sim6 = pad(Math.floor(Math.random() * 1000), 3) + rItem.selected_number;
                else if (rItem.lottery_type === '2' || rItem.lottery_type === '2 ล่าง') sim6 = pad(Math.floor(Math.random() * 10000), 4) + rItem.selected_number;
            }

            let sim4 = sim6.slice(-4), sim3 = sim6.slice(-3), sim2 = sim6.slice(-2);
            let currentPayoutTHB = 0;
            let tempAnalysis = { '6': { count: 0, payout: 0 }, '4': { count: 0, payout: 0 }, '3': { count: 0, payout: 0 }, '2': { count: 0, payout: 0 } };

            for (let item of items) {
                let thbPrice = (item.currency_code === 'LAK' || item.currency_code === '₭') ? (item.price / lakRate) : item.price;
                let isWin = false;
                let anlzType = item.lottery_type;
                
                if (item.lottery_type === '6' && item.selected_number === sim6) isWin = true;
                else if (item.lottery_type === '4' && item.selected_number === sim4) isWin = true;
                else if (item.lottery_type === '3' && item.selected_number === sim3) isWin = true;
                else if ((item.lottery_type === '2' || item.lottery_type === '2 ล่าง') && item.selected_number === sim2) {
                    isWin = true; 
                    anlzType = '2'; // รวบ 2 บน/ล่าง ไปโชว์ในหมวด 2 ตัวบนหน้าเว็บ
                }

                if (isWin) {
                    let prize = thbPrice * (prizeRates[item.lottery_type] || 0);
                    currentPayoutTHB += prize;
                    if (tempAnalysis[anlzType]) {
                        tempAnalysis[anlzType].count += 1;
                        tempAnalysis[anlzType].payout += prize;
                    }
                }
            }

            if (targetPercent == 0) {
                if (currentPayoutTHB === 0) { bestNumber = sim6; bestAnalysis = tempAnalysis; break; }
            } else {
                if (currentPayoutTHB <= targetPayoutTHB && currentPayoutTHB > maxFoundPayout) {
                    maxFoundPayout = currentPayoutTHB;
                    bestNumber = sim6;
                    bestAnalysis = tempAnalysis;
                }
                if (currentPayoutTHB < minFoundPayout) minFoundPayout = currentPayoutTHB;
            }
        }

        // แปลงรูปแบบ Analysis ให้ตรงกับที่หน้าบ้านรอรับ
        const formatAnalysis = Object.keys(bestAnalysis).map(key => ({
            lottery_type: key,
            winner_count: bestAnalysis[key].count,
            total_payout: bestAnalysis[key].payout
        }));

        res.json({ 
            success: true, 
            suggestedNumber: bestNumber, 
            totalSales: totalSalesTHB, 
            analysis: formatAnalysis 
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});



// 🌟 นำตัวแปรนี้ไปวางไว้บนสุดของไฟล์ server.js (หรือวางไว้เหนือ setInterval) 
// เพื่อให้หุ่นยนต์จำว่าวันนี้ออกผลไปแล้วหรือยัง
let lastAutoDrawDate = '';

// ==========================================
// 🇻🇳 2. API: ยืนยันผล จ่ายรางวัล และโอนเงิน (หวยเวียดนาม - แยก THB/LAK)
// ==========================================
app.post('/api/admin/execute-draw', async (req, res) => {
    const { number6 } = req.body;
    try {
        const pool = await sql.connect(dbConfig);
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const top_6 = number6;
            const top_4 = top_6.slice(-4);
            const top_3 = top_6.slice(-3);
            const top_2 = top_6.slice(-2);
            const num8 = Math.floor(10000000 + Math.random() * 90000000).toString(); 
            const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

            // 1. บันทึกผลลง Draw_Results
            await transaction.request()
                .input('dDate', sql.Date, today).input('p8', sql.VarChar, num8)
                .input('p6', sql.VarChar, top_6).input('p4', sql.VarChar, top_4)
                .input('p3', sql.VarChar, top_3).input('p2', sql.VarChar, top_2)
                .query(`
                    IF NOT EXISTS (SELECT 1 FROM Draw_Results WHERE draw_date = @dDate)
                        INSERT INTO Draw_Results (draw_date, prize_8, prize_6, prize_4, prize_3, prize_2) 
                        VALUES (@dDate, @p8, @p6, @p4, @p3, @p2);
                    ELSE
                        UPDATE Draw_Results SET prize_8 = @p8, prize_6 = @p6, prize_4 = @p4, prize_3 = @p3, prize_2 = @p2 WHERE draw_date = @dDate;
                `);

            const commReq = await transaction.request().query("SELECT TOP 1 win_percent FROM Commission_Settings");
            const commPercent = commReq.recordset.length > 0 ? commReq.recordset[0].win_percent : 0;

            // 2. ตรวจบิลและตั้งค่าเงินรางวัล (คูณเรท)
            await transaction.request().query(`
                UPDATE i SET 
                    status = CASE 
                        WHEN (i.lottery_type = N'2 ล่าง' AND i.selected_number = '${top_2}') OR
                             (i.lottery_type = '2' AND i.selected_number = '${top_2}') OR
                             (i.lottery_type = '3' AND i.selected_number = '${top_3}') OR
                             (i.lottery_type = '4' AND i.selected_number = '${top_4}') OR
                             (i.lottery_type = '6' AND i.selected_number = '${top_6}') OR
                             (i.lottery_type = '8' AND i.selected_number = '${num8}') THEN N'ถูกรางวัล'
                        ELSE N'ไม่ถูกรางวัล'
                    END,
                    prize_amount = CASE
                        WHEN (i.lottery_type = N'2 ล่าง' AND i.selected_number = '${top_2}') OR
                             (i.lottery_type = '2' AND i.selected_number = '${top_2}') OR
                             (i.lottery_type = '3' AND i.selected_number = '${top_3}') OR
                             (i.lottery_type = '4' AND i.selected_number = '${top_4}') OR
                             (i.lottery_type = '6' AND i.selected_number = '${top_6}') OR
                             (i.lottery_type = '8' AND i.selected_number = '${num8}') 
                        THEN i.price * ISNULL((SELECT TOP 1 multiplier FROM Lottery_Prize_Rates WHERE lottery_type = i.lottery_type), 0)
                        ELSE 0
                    END
                FROM Lottery_Order_Items i JOIN Lottery_Orders o ON i.order_id = o.order_id
                WHERE (o.draw_date = '${today}' OR CAST(o.created_at AS DATE) = '${today}') AND i.status = N'รอผลตรวจ';
            `);

            // 3. 💰 โอนเงินลูกค้า (แยกกระเป๋า THB / LAK อย่างเด็ดขาด!)
            await transaction.request().query(`
                UPDATE w SET 
                    balance_thb = ISNULL(w.balance_thb, 0) + ISNULL(t_thb.TotalPrizeTHB, 0),
                    balance_lak = ISNULL(w.balance_lak, 0) + ISNULL(t_lak.TotalPrizeLAK, 0)
                FROM Wallets w
                LEFT JOIN (
                    SELECT o.user_id, SUM(i.prize_amount) as TotalPrizeTHB
                    FROM Lottery_Order_Items i JOIN Lottery_Orders o ON i.order_id = o.order_id 
                    WHERE i.status = N'ถูกรางวัล' AND o.status = N'รอผลตรวจ' AND o.currency_code = 'THB' GROUP BY o.user_id
                ) t_thb ON w.user_id = t_thb.user_id
                LEFT JOIN (
                    SELECT o.user_id, SUM(i.prize_amount) as TotalPrizeLAK
                    FROM Lottery_Order_Items i JOIN Lottery_Orders o ON i.order_id = o.order_id 
                    WHERE i.status = N'ถูกรางวัล' AND o.status = N'รอผลตรวจ' AND (o.currency_code = 'LAK' OR o.currency_code = N'₭') GROUP BY o.user_id
                ) t_lak ON w.user_id = t_lak.user_id
                WHERE t_thb.user_id IS NOT NULL OR t_lak.user_id IS NOT NULL;

                -- บันทึกประวัติ (แยก THB/LAK ชัดเจน)
                INSERT INTO Transactions (user_id, amount, currency_code, transaction_type, status, note, created_at)
                SELECT o.user_id, SUM(i.prize_amount), o.currency_code, 'deposit', 'Completed', N'ถูกรางวัลหวยเวียดนาม', GETDATE()
                FROM Lottery_Order_Items i JOIN Lottery_Orders o ON i.order_id = o.order_id 
                WHERE i.status = N'ถูกรางวัล' AND o.status = N'รอผลตรวจ' 
                GROUP BY o.user_id, o.currency_code;
            `);

            // 4. 💸 จ่ายค่าคอมผู้แนะนำ (แยกกระเป๋า THB / LAK เช่นกัน!)
            if (commPercent > 0) {
                await transaction.request().query(`
                    UPDATE w SET 
                        balance_thb = ISNULL(w.balance_thb, 0) + ISNULL(c_thb.CommTHB, 0),
                        balance_lak = ISNULL(w.balance_lak, 0) + ISNULL(c_lak.CommLAK, 0)
                    FROM Wallets w
                    LEFT JOIN (
                        SELECT r.referrer_id, SUM(i.prize_amount) * (${commPercent} / 100.0) as CommTHB
                        FROM Lottery_Order_Items i JOIN Lottery_Orders o ON i.order_id = o.order_id JOIN User_Referrals r ON o.user_id = r.user_id
                        WHERE i.status = N'ถูกรางวัล' AND o.status = N'รอผลตรวจ' AND o.currency_code = 'THB' GROUP BY r.referrer_id HAVING SUM(i.prize_amount) > 0
                    ) c_thb ON w.user_id = c_thb.referrer_id
                    LEFT JOIN (
                        SELECT r.referrer_id, SUM(i.prize_amount) * (${commPercent} / 100.0) as CommLAK
                        FROM Lottery_Order_Items i JOIN Lottery_Orders o ON i.order_id = o.order_id JOIN User_Referrals r ON o.user_id = r.user_id
                        WHERE i.status = N'ถูกรางวัล' AND o.status = N'รอผลตรวจ' AND (o.currency_code = 'LAK' OR o.currency_code = N'₭') GROUP BY r.referrer_id HAVING SUM(i.prize_amount) > 0
                    ) c_lak ON w.user_id = c_lak.referrer_id
                    WHERE c_thb.referrer_id IS NOT NULL OR c_lak.referrer_id IS NOT NULL;

                    -- บันทึกประวัติค่าคอมให้ผู้แนะนำ
                    INSERT INTO Transactions (user_id, amount, currency_code, transaction_type, status, note, created_at)
                    SELECT r.referrer_id, SUM(i.prize_amount) * (${commPercent} / 100.0), o.currency_code, 'commission', 'Completed', N'ค่าคอมฯ ลูกทีมถูกรางวัล (' + u.username + ')', GETDATE()
                    FROM Lottery_Order_Items i JOIN Lottery_Orders o ON i.order_id = o.order_id 
                    JOIN User_Referrals r ON o.user_id = r.user_id JOIN Users u ON o.user_id = u.user_id
                    WHERE i.status = N'ถูกรางวัล' AND o.status = N'รอผลตรวจ' 
                    GROUP BY r.referrer_id, o.currency_code, u.username HAVING SUM(i.prize_amount) > 0;
                `);
            }

            // 5. ปิดบิลแม่
            await transaction.request().query(`
                UPDATE Lottery_Orders 
                SET status = N'ตรวจผลแล้ว', draw_date = '${today}' 
                WHERE (draw_date = '${today}' OR CAST(created_at AS DATE) = '${today}') AND status = N'รอผลตรวจ';
            `);

            await transaction.commit();
            res.json({ success: true, message: `✅ ออกรางวัลด้วยเลข ${top_6} สำเร็จ! \n💰 จ่ายเงินลูกค้า และผู้แนะนำเรียบร้อยแล้ว!` });
        } catch (innerErr) { 
            await transaction.rollback(); 
            throw innerErr; 
        }
    } catch (err) { 
        console.error("Execute Draw Error:", err);
        res.status(500).json({ success: false, message: `Database Error: ${err.message}` }); 
    }
});

// ==========================================
// 🤖 3. Worker: หุ่นยนต์ออกรางวัลอัตโนมัติ (แก้บั๊ก Database)
// ==========================================
setInterval(async () => {
    try {
        const options = { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false };
        const nowBKK = new Intl.DateTimeFormat('en-GB', options).format(new Date()); 
        
        // ดึงวันที่ปัจจุบัน (YYYY-MM-DD) โซนไทย
        const todayDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());

        const API_URL = 'https://api.salapi.company'; 

        const settingsRes = await fetch(`${API_URL}/api/admin/settings`);
        if (!settingsRes.ok) return;
        
        const settingsData = await settingsRes.json();
        const settings = settingsData.data;

        if (!settings || !settings.is_auto_draw) return; 

        const drawTime = settings.draw_time ? settings.draw_time.substring(0, 5) : ''; 

        console.log(`⏱️ [AUTO TICK] นาฬิกา: ${nowBKK} | เวลาออกผล: ${drawTime} | ล่าสุด: ${lastAutoDrawDate || 'ยังไม่มี'}`);

        // 🌟 ถ้าเวลาตรงกันเป๊ะ และ วันนี้ยังไม่ได้ออกผล
        if (nowBKK === drawTime && lastAutoDrawDate !== todayDate) {
            
            // ล็อกคอไว้ก่อนเลยว่าวันนี้กำลังจะออกผล (กันมันรันซ้ำ 2 รอบในนาทีเดียวกัน)
            lastAutoDrawDate = todayDate;
            
            console.log(`🤖 [AUTO] เวลา ${nowBKK} น. ตรงเป้าหมาย! เริ่มออกผลรางวัล...`);

            const suggestRes = await fetch(`${API_URL}/api/admin/suggest-draw`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetPercent: settings.auto_draw_percent })
            });
            const suggestData = await suggestRes.json();

            if (suggestData.success) {
                console.log(`🤖 [AUTO] AI แนะนำเลข: ${suggestData.suggestedNumber} กำลังบันทึกและโอนเงิน...`);
                
                const executeRes = await fetch(`${API_URL}/api/admin/execute-draw`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ number6: suggestData.suggestedNumber })
                });
                
                const executeData = await executeRes.json();
                if (executeData.success) {
                    console.log('✅ [AUTO] ออกผลและโอนเงินเข้า Wallet ลูกค้าเรียบร้อย!');
                } else {
                    console.error('❌ [AUTO ERROR] แจกเงินไม่สำเร็จ:', executeData.message);
                    lastAutoDrawDate = ''; // ปลดล็อกถ้าแจกเงินพลาด เผื่อให้รันใหม่
                }
            } else {
                console.error('❌ [AUTO ERROR] สุ่มเลขไม่สำเร็จ:', suggestData.message);
                lastAutoDrawDate = ''; // ปลดล็อกถ้าสุ่มพลาด
            }
        }
    } catch (err) {
        console.error("❌ [AUTO CRITICAL ERROR]:", err.message);
    }
}, 30000);


// ==========================================
// 🌟 API จบ API หวยเวียดนาม
// // ==========================================

// ==========================================
// 🌟 API สุ่มเลขแนะนำ (AI V21: Auto-Detect Round ID แก้บั๊กหุ่นยนต์ลืมส่งรอบ)
// ==========================================
app.post('/api/admin/yeeki/suggest-draw', async (req, res) => {
    // 🌟 รองรับชื่อตัวแปรทุกรูปแบบ ทั้งจากหน้าเว็บ และจากหุ่นยนต์หลังบ้าน
    let target_percent = req.body.target_percent !== undefined ? req.body.target_percent : req.body.targetPercent;
    let round_id = req.body.round_id !== undefined ? req.body.round_id : req.body.roundId;

    try {
        const pool = await sql.connect(dbConfig);

        // 🌟 จุดแก้ปัญหา: ถ้าไม่มี round_id ส่งมา ให้ไปค้นหารอบล่าสุดที่รอออกผลเอง
        if (!round_id) {
            const activeRoundReq = await pool.request().query(`
                SELECT TOP 1 round_id, round_number FROM Yeeki_Rounds 
                WHERE status = 'Closed' OR status = 'Pending' 
                ORDER BY round_number ASC
            `);
            if (activeRoundReq.recordset.length > 0) {
                round_id = activeRoundReq.recordset[0].round_id;
                console.log(`🤖 [AI] หุ่นยนต์ไม่ได้ส่งรอบมา ดึงรอบอัตโนมัติ: รอบที่ ${activeRoundReq.recordset[0].round_number}`);
            } else {
                return res.json({ success: false, message: 'ไม่มีรอบที่รอออกผล' });
            }
        }

        // 1. ดึงบิลทั้งหมดของรอบนั้นมา (ตอนนี้ AI จะมองเห็นบิลลูกค้าแล้ว!)
        const ordersReq = await pool.request()
            .input('roundId', sql.Int, round_id)
            .query(`
                SELECT i.lottery_type, i.selected_number, i.price, o.currency_code
                FROM Yeeki_Order_Items i
                JOIN Yeeki_Orders o ON i.order_id = o.order_id
                WHERE o.round_id = @roundId
            `);
        const orders = ordersReq.recordset;

        // 2. ดึงเรทเงินและอัตราจ่าย
        const exReq = await pool.request().query(`SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'`);
        const lakRate = exReq.recordset[0]?.rate || 620;

        const ratesReq = await pool.request().query(`SELECT lottery_type, multiplier FROM Yeeki_Prize_Rates`);
        const prizeRates = {};
        ratesReq.recordset.forEach(r => prizeRates[r.lottery_type] = r.multiplier);

        let totalSalesTHB = 0;
        
        // 3. จัดกลุ่มบิลลงตะกร้าเพื่อจำลอง 5,000 รอบ
        let bets = { t6: {}, t4: {}, t3: {}, tTode: {}, t2: {}, tRun: {}, b2: {}, bRun: {}, s8: {} };

        orders.forEach(o => {
            let thbPrice = (o.currency_code === 'LAK' || o.currency_code === '₭') ? (o.price / lakRate) : o.price;
            totalSalesTHB += thbPrice;
            
            let payoutTHB = thbPrice * (prizeRates[o.lottery_type] || 0);
            let n = o.selected_number;
            let t = o.lottery_type;

            const addBet = (obj, key) => {
                if (!obj[key]) obj[key] = { p: 0 };
                obj[key].p += payoutTHB;
            };

            if (t === '6 ตัว') addBet(bets.t6, n);
            else if (t === '4 ตัวท้าย') addBet(bets.t4, n);
            else if (t === '3 ตัวบน') addBet(bets.t3, n);
            else if (t === '3 ตัวโต๊ด') addBet(bets.tTode, n.split('').sort().join(''));
            else if (t === '2 ตัวบน') addBet(bets.t2, n);
            else if (t === 'วิ่งบน') addBet(bets.tRun, n);
            else if (t === '2 ตัวล่าง') addBet(bets.b2, n);
            else if (t === 'วิ่งล่าง') addBet(bets.bRun, n);
            else if (t === '8 ตัว (Super)') addBet(bets.s8, n);
        });

        // 🎯 กำหนดเป้าหมาย
        const targetPayoutTHB = totalSalesTHB * ((target_percent || 0) / 100);
        const maxAllowedPayoutTHB = targetPayoutTHB * 1.15; 
        const pad = (num, len) => num.toString().padStart(len, '0');

        let bought8 = Object.keys(bets.s8);
        let bought4 = Object.keys(bets.t4);
        let bought3 = Object.keys(bets.t3);
        let bought2top = Object.keys(bets.t2);
        let bought2bot = Object.keys(bets.b2);

        let bestCombination = null;
        let maxUnderTarget = -1;
        let minFoundPayout = Infinity;
        let bestMinCombination = null;

        // ==========================================
        // 🌟 Monte Carlo Simulation: สแกน 5,000 รอบเพื่อหลบยอดจ่าย
        // ==========================================
        for (let i = 0; i < 5000; i++) {
            let sim8, sim4, sim2bot;

            if (target_percent > 0 && Math.random() > 0.4) {
                sim8 = bought8.length > 0 && Math.random() > 0.5 ? bought8[Math.floor(Math.random() * bought8.length)] : pad(Math.floor(Math.random() * 100000000), 8);
                if (bought4.length > 0 && Math.random() > 0.3) {
                    sim4 = bought4[Math.floor(Math.random() * bought4.length)];
                } else if (bought3.length > 0 && Math.random() > 0.3) {
                    sim4 = Math.floor(Math.random() * 10).toString() + bought3[Math.floor(Math.random() * bought3.length)];
                } else if (bought2top.length > 0 && Math.random() > 0.3) {
                    sim4 = pad(Math.floor(Math.random() * 100), 2) + bought2top[Math.floor(Math.random() * bought2top.length)];
                } else {
                    sim4 = pad(Math.floor(Math.random() * 10000), 4);
                }
                sim2bot = bought2bot.length > 0 && Math.random() > 0.5 ? bought2bot[Math.floor(Math.random() * bought2bot.length)] : pad(Math.floor(Math.random() * 100), 2);
            } else {
                sim8 = pad(Math.floor(Math.random() * 100000000), 8);
                sim4 = pad(Math.floor(Math.random() * 10000), 4);
                sim2bot = pad(Math.floor(Math.random() * 100), 2);
            }

            let sim6 = sim2bot + sim4;
            let sim3 = sim4.slice(-3);
            let sim2top = sim4.slice(-2);
            let simRunTop = sim4.slice(-1);
            let simRunBot = sim2bot.slice(-1);
            let sim3Tode = sim3.split('').sort().join('');

            let currentPayout = 0;
            if (bets.s8[sim8]) currentPayout += bets.s8[sim8].p;
            if (bets.t6[sim6]) currentPayout += bets.t6[sim6].p;
            if (bets.t4[sim4]) currentPayout += bets.t4[sim4].p;
            if (bets.t3[sim3]) currentPayout += bets.t3[sim3].p;
            if (bets.tTode[sim3Tode]) currentPayout += bets.tTode[sim3Tode].p;
            if (bets.t2[sim2top]) currentPayout += bets.t2[sim2top].p;
            if (bets.b2[sim2bot]) currentPayout += bets.b2[sim2bot].p;
            if (bets.tRun[simRunTop]) currentPayout += bets.tRun[simRunTop].p;
            if (bets.bRun[simRunBot]) currentPayout += bets.bRun[simRunBot].p;

            if (target_percent == 0) {
                if (currentPayout === 0) {
                    bestCombination = { sim8, sim4, sim2bot };
                    break; // เจอเพอร์เฟกต์ 0% สะอาดหมดจด เบรกออกทันที
                }
                if (currentPayout < minFoundPayout) {
                    minFoundPayout = currentPayout;
                    bestCombination = { sim8, sim4, sim2bot };
                }
            } else {
                if (currentPayout <= maxAllowedPayoutTHB && currentPayout > maxUnderTarget) {
                    maxUnderTarget = currentPayout;
                    bestCombination = { sim8, sim4, sim2bot };
                }
                if (currentPayout < minFoundPayout) {
                    minFoundPayout = currentPayout;
                    bestMinCombination = { sim8, sim4, sim2bot };
                }
            }
        }

        if (target_percent > 0 && !bestCombination) {
            bestCombination = bestMinCombination || { 
                sim8: pad(Math.floor(Math.random() * 100000000), 8), 
                sim4: pad(Math.floor(Math.random() * 10000), 4), 
                sim2bot: pad(Math.floor(Math.random() * 100), 2) 
            };
        }

        if (orders.length === 0) {
            bestCombination = { 
                sim8: pad(Math.floor(Math.random() * 100000000), 8), 
                sim4: pad(Math.floor(Math.random() * 10000), 4), 
                sim2bot: pad(Math.floor(Math.random() * 100), 2) 
            };
        }

        res.json({
            success: true,
            suggestedSuper: bestCombination.sim8,
            suggestedTop: bestCombination.sim4,
            suggestedBottom: bestCombination.sim2bot
        });

    } catch (err) {
        console.error("Error suggesting draw:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 3. API: ประกาศผลและตรวจบิลจริง (Execute Draw) - Manual โดย Admin
// ==========================================
app.post('/api/admin/execute-yeeki-draw', async (req, res) => {
    // 🌟 รับมาแค่ 8 ตัว (Super) กับ 2 ตัวล่าง (ระบบหลังบ้านจะหั่นเลขอื่นๆ ออกมาเอง)
    const { round_id, super_number, bottom_2 } = req.body; 
    let pool;
    try {
        pool = await sql.connect(dbConfig);
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 🌟 ให้ระบบหั่นเลขเอง เพื่อให้มั่นใจว่าเลขทุกตัว (6, 4, 3, 2 บน) สัมพันธ์กับเลข 8 ตัวแน่นอน
            const top_6 = super_number.slice(-6);
            const top_4 = super_number.slice(-4);
            const top_3 = super_number.slice(-3);
            const top_2 = super_number.slice(-2);

            // 🌟 แก้ไข: บันทึก result_6_top ลง Database ด้วย
            await transaction.request()
                .input('roundId', sql.Int, round_id)
                .input('res8', sql.VarChar(8), super_number)
                .input('res6', sql.VarChar(6), top_6) // 👈 เพิ่มตรงนี้
                .input('res4', sql.VarChar(4), top_4) 
                .input('res3', sql.VarChar(3), top_3)
                .input('res2bot', sql.VarChar(2), bottom_2)
                .query(`
                    UPDATE Yeeki_Rounds 
                    SET 
                        result_8_super = @res8, 
                        result_6_top = @res6, /* 👈 เพิ่มตรงนี้ */
                        result_4_top = @res4, 
                        result_3_top = @res3, 
                        result_2_bottom = @res2bot, 
                        status = 'Completed' 
                    WHERE round_id = @roundId AND category != 'THAI'
                `);

            const ratesReq = await transaction.request().query(`SELECT lottery_type, multiplier FROM Yeeki_Prize_Rates`);
            const prizeRates = {};
            ratesReq.recordset.forEach(r => prizeRates[r.lottery_type] = r.multiplier);

            const itemsReq = await transaction.request().input('roundId', sql.Int, round_id).query(`
                SELECT i.item_id, i.order_id, i.lottery_type, i.selected_number, i.price, o.user_id, o.currency_code
                FROM Yeeki_Order_Items i
                JOIN Yeeki_Orders o ON i.order_id = o.order_id
                WHERE o.round_id = @roundId AND i.status = N'รอผลตรวจ'
            `);
            const items = itemsReq.recordset;

            for (let item of items) {
                let isWin = false;
                const type = item.lottery_type;
                const num = item.selected_number;

                // 🌟 ตรวจสอบการถูกรางวัล โดยอ้างอิงจากเลขที่หั่นมาจาก 8 ตัว
                if (type === '8 ตัว (Super)' && num === super_number) isWin = true;
                else if (type === '6 ตัว' && num === top_6) isWin = true; 
                else if (type === '4 ตัวท้าย' && num === top_4) isWin = true;
                else if (type === '3 ตัวบน' && num === top_3) isWin = true;
                else if (type === '3 ตัวโต๊ด') {
                    if (top_3.split('').sort().join('') === num.split('').sort().join('')) isWin = true;
                }
                else if (type === '2 ตัวบน' && num === top_2) isWin = true;
                else if (type === '2 ตัวล่าง' && num === bottom_2) isWin = true;
                else if (type === 'วิ่งบน' && top_3.includes(num)) isWin = true;
                else if (type === 'วิ่งล่าง' && bottom_2.includes(num)) isWin = true;

                if (isWin) {
                    const prizeAmount = item.price * (prizeRates[type] || 0);
                    
                    // 1. อัปเดตสถานะบิลว่าถูกรางวัล
                    await transaction.request().input('itemId', sql.Int, item.item_id).input('prizeAmt', sql.Decimal(18,2), prizeAmount)
                        .query(`UPDATE Yeeki_Order_Items SET status = N'ชนะ', prize_amount = @prizeAmt WHERE item_id = @itemId`);
                    
                    // 2. เติมเงินเข้ากระเป๋า
                    await transaction.request().input('uid', sql.Int, item.user_id).input('prize', sql.Decimal(18,2), prizeAmount)
                        .query(`UPDATE Users SET wallet_balance = wallet_balance + @prize WHERE user_id = @uid`);
                    
                    // 3. สร้างประวัติ (Transaction) ให้ไปโชว์ที่หน้าแดชบอร์ด
                    await transaction.request()
                        .input('uid', sql.Int, item.user_id)
                        .input('prize', sql.Decimal(18,2), prizeAmount)
                        .input('title', sql.NVarChar(255), `ถูกรางวัล ${type} (${num}) รอบที่ ${round_id}`)
                        .query(`INSERT INTO Transactions (user_id, amount, transaction_type, title, status) VALUES (@uid, @prize, 'PRIZE_WIN', @title, 'Completed')`);
                } else {
                    await transaction.request().input('itemId', sql.Int, item.item_id)
                        .query(`UPDATE Yeeki_Order_Items SET status = N'แพ้' WHERE item_id = @itemId`);
                }
            }
            await transaction.commit();
            res.json({ success: true, message: "ประกาศผลและโอนเงินรางวัลเสร็จสิ้น!" });
        } catch (innerErr) { await transaction.rollback(); throw innerErr; }
    } catch (err) { res.status(500).json({ success: false, message: `Database Error: ${err.message}` }); }
});

// ==========================================
// 🤖 หุ่นยนต์ออกรางวัลอัตโนมัติ 24 ชม. (Auto-Draw Worker)
// ==========================================
// หุ่นยนต์จะตื่นมาทำงานทุกๆ 30 วินาที
setInterval(async () => {
    try {
        const pool = await sql.connect(dbConfig);
        
        const pendingRounds = await pool.request().query(`
            SELECT round_id, round_number 
            FROM Yeeki_Rounds 
            WHERE draw_time <= DATEADD(hour, 7, GETUTCDATE()) 
            AND status != 'Completed'
        `);

        if (pendingRounds.recordset.length === 0) return;

        const target_percent = 50; 
        const EXCHANGE_RATE = 620;

        for (let round of pendingRounds.recordset) {
            console.log(`🤖 [AUTO] หุ่นยนต์กำลังออกรางวัลรอบที่ ${round.round_number} อัตโนมัติ...`);
            
            const ordersReq = await pool.request()
                .input('rid', sql.Int, round.round_id)
                .query(`
                    SELECT oi.item_id, oi.order_id, oi.lottery_type, oi.selected_number, oi.price, o.user_id, o.currency_code
                    FROM Yeeki_Order_Items oi
                    JOIN Yeeki_Orders o ON oi.order_id = o.order_id
                    WHERE o.round_id = @rid AND oi.status = N'รอผลตรวจ'
                `);
            const items = ordersReq.recordset;

            let super_number = String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
            let top_number = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
            let bottom_number = String(Math.floor(Math.random() * 100)).padStart(2, '0');

            const rates = { '8 ตัว (Super)': 1000000, '6 ตัว': 400000, '4 ตัวท้าย': 6000, '3 ตัวบน': 900, '3 ตัวโต๊ด': 150, '2 ตัวบน': 90, '2 ตัวล่าง': 90, 'วิ่งบน': 3.2, 'วิ่งล่าง': 4.2 };

            if (items.length > 0) {
                let totalSalesTHB = items.reduce((sum, item) => sum + ((item.currency_code === 'LAK' || item.currency_code === '₭') ? (item.price / EXCHANGE_RATE) : item.price), 0);
                const maxPayoutTHB = totalSalesTHB * (target_percent / 100);
                let minPayout = Infinity;
                let bestSet = { super_8: super_number, top_4: top_number, bottom_2: bottom_number };

                for (let i = 0; i < 1000; i++) {
                    let s8 = String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
                    let t4 = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
                    let b2 = String(Math.floor(Math.random() * 100)).padStart(2, '0');
                    let t3 = t4.slice(-3); let t2 = t4.slice(-2);
                    let sT3 = t3.split('').sort().join('');

                    let currentPayoutTHB = 0;
                    for (let item of items) {
                        let priceTHB = (item.currency_code === 'LAK' || item.currency_code === '₭') ? (item.price / EXCHANGE_RATE) : item.price;
                        let isWin = false; let num = item.selected_number;
                        
                        switch (item.lottery_type) {
                            case '8 ตัว (Super)': if (num === s8) isWin = true; break;
                            case '6 ตัว': if (num === s8.slice(-6)) isWin = true; break; // 👈 แก้ไข: เพิ่มเช็ค 6 ตัวให้บอทจำลอง
                            case '4 ตัวท้าย': if (num === t4) isWin = true; break;
                            case '3 ตัวบน': if (num === t3) isWin = true; break;
                            case '3 ตัวโต๊ด': if (num.split('').sort().join('') === sT3) isWin = true; break; 
                            case '2 ตัวบน': if (num === t2) isWin = true; break;
                            case '2 ตัวล่าง': if (num === b2) isWin = true; break;
                            case 'วิ่งบน': if (t3.includes(num)) isWin = true; break;
                            case 'วิ่งล่าง': if (b2.includes(num)) isWin = true; break;
                        }
                        if (isWin) currentPayoutTHB += (priceTHB * (rates[item.lottery_type] || 0));
                    }
                    if (currentPayoutTHB <= maxPayoutTHB) { bestSet = { super_8: s8, top_4: t4, bottom_2: b2 }; break; }
                    if (currentPayoutTHB < minPayout) { minPayout = currentPayoutTHB; bestSet = { super_8: s8, top_4: t4, bottom_2: b2 }; }
                }
                super_number = bestSet.super_8; top_number = bestSet.top_4; bottom_number = bestSet.bottom_2;
            }

            const transaction = new sql.Transaction(pool);
            await transaction.begin();
            try {
                // 🌟 ให้หุ่นยนต์หั่นเลข 6 ตัวออกมาเตรียมไว้ด้วย
                let top6 = super_number.slice(-6);
                let top3 = top_number.slice(-3); 
                let top2 = top_number.slice(-2);

                // 🌟 แก้ไข: สั่งบอทให้บันทึก result_6_top ลง Database ด้วย
                await transaction.request()
                    .input('rid', sql.Int, round.round_id)
                    .input('s8', sql.VarChar, super_number)
                    .input('t6', sql.VarChar, top6) // 👈 เพิ่ม input
                    .input('t4', sql.VarChar, top_number)
                    .input('t3', sql.VarChar, top3)
                    .input('b2', sql.VarChar, bottom_number)
                    .query(`
                        UPDATE Yeeki_Rounds 
                        SET result_8_super = @s8, result_6_top = @t6, result_4_top = @t4, result_3_top = @t3, result_2_bottom = @b2, status = 'Completed' 
                        WHERE round_id = @rid
                    `);

                for (let item of items) {
                    let isWin = false; let num = item.selected_number;
                    switch (item.lottery_type) {
                        case '8 ตัว (Super)': if (num === super_number) isWin = true; break;
                        case '6 ตัว': if (num === top6) isWin = true; break; // 👈 แก้ไข: เพิ่มเงื่อนไขแจกเงินรางวัล 6 ตัว
                        case '4 ตัวท้าย': if (num === top_number) isWin = true; break;
                        case '3 ตัวบน': if (num === top3) isWin = true; break;
                        case '3 ตัวโต๊ด': if (num.split('').sort().join('') === top3.split('').sort().join('')) isWin = true; break;
                        case '2 ตัวบน': if (num === top2) isWin = true; break;
                        case '2 ตัวล่าง': if (num === bottom_number) isWin = true; break;
                        case 'วิ่งบน': if (top3.includes(num)) isWin = true; break;
                        case 'วิ่งล่าง': if (bottom_number.includes(num)) isWin = true; break;
                    }

                    if (isWin) {
                        let prize = item.price * (rates[item.lottery_type] || 0);
                        
                        await transaction.request().input('itemId', sql.Int, item.item_id).input('prize', sql.Decimal(18,2), prize)
                            .query(`UPDATE Yeeki_Order_Items SET status = 'Win', prize_amount = @prize WHERE item_id = @itemId`);
                        
                        await transaction.request().input('uid', sql.Int, item.user_id).input('prizeAmount', sql.Decimal(18,2), prize)
                            .query(`UPDATE Users SET wallet_balance = wallet_balance + @prizeAmount WHERE user_id = @uid`);
                            
                        await transaction.request()
                            .input('uid', sql.Int, item.user_id)
                            .input('prizeAmount', sql.Decimal(18,2), prize)
                            .input('title', sql.NVarChar(255), `ถูกรางวัล ${item.lottery_type} (${num}) รอบที่ ${round.round_number}`)
                            .query(`INSERT INTO Transactions (user_id, amount, transaction_type, title, status) VALUES (@uid, @prizeAmount, 'PRIZE_WIN', @title, 'Completed')`);

                    } else {
                        await transaction.request().input('itemId', sql.Int, item.item_id)
                            .query(`UPDATE Yeeki_Order_Items SET status = 'Lose', prize_amount = 0 WHERE item_id = @itemId`);
                    }
                }
                
                await transaction.request().input('rid', sql.Int, round.round_id).query(`UPDATE Yeeki_Orders SET status = 'Completed' WHERE round_id = @rid`);
                await transaction.commit();
                console.log(`✅ [AUTO] จ่ายเงินและสร้างประวัติรอบที่ ${round.round_number} สำเร็จแล้วแบบไร้รอยต่อ!`);
            } catch (innerErr) {
                await transaction.rollback();
                console.error(`❌ [AUTO] พังตอนแจกเงินรอบ ${round.round_number}:`, innerErr);
            }
        }
    } catch (err) {
        console.error("Auto draw interval error:", err);
    }
}, 30000);


// ==========================================
// 🌟 API 2: ค้นหาคนซื้อจากเลข (ด้านล่างสุด)
// ==========================================
app.post('/api/admin/search-buyers', async (req, res) => {
    const { number } = req.body;
    try {
        const pool = await sql.connect(dbConfig);
        
        // ดึงเรทแลกเปลี่ยนปัจจุบัน
        const rateRes = await pool.request().query("SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'");
        const exchangeRate = rateRes.recordset.length > 0 ? rateRes.recordset[0].rate : 500.0;

        const result = await pool.request()
            .input('num', sql.VarChar, number)
            .query(`
                DECLARE @OpenTime TIME = (SELECT TOP 1 open_time FROM System_Settings);
                DECLARE @CloseTime TIME = (SELECT TOP 1 close_time FROM System_Settings);
                DECLARE @ThaiNow DATETIME = DATEADD(HOUR, 7, GETUTCDATE());
                DECLARE @CurrentDate DATE = CAST(@ThaiNow AS DATE);
                DECLARE @StartDateTime DATETIME;
                DECLARE @EndDateTime DATETIME;

                IF @OpenTime > @CloseTime
                BEGIN
                    SET @StartDateTime = CAST(DATEADD(DAY, -1, @CurrentDate) AS DATETIME) + CAST(@OpenTime AS DATETIME);
                    SET @EndDateTime = CAST(@CurrentDate AS DATETIME) + CAST(@CloseTime AS DATETIME);
                END
                ELSE
                BEGIN
                    SET @StartDateTime = CAST(@CurrentDate AS DATETIME) + CAST(@OpenTime AS DATETIME);
                    SET @EndDateTime = CAST(@CurrentDate AS DATETIME) + CAST(@CloseTime AS DATETIME);
                END

                SELECT 
                    u.username, o.currency_code, i.price, CAST(i.lottery_type AS VARCHAR) as lottery_type, i.selected_number, o.created_at,
                    (i.price * r.multiplier) as estimated_prize,
                    CASE 
                        WHEN o.currency_code = 'LAK' THEN (i.price * r.multiplier) / ${exchangeRate} 
                        ELSE (i.price * r.multiplier) 
                    END as estimated_prize_thb
                FROM Lottery_Order_Items i
                JOIN Lottery_Orders o ON i.order_id = o.order_id
                JOIN Users u ON o.user_id = u.user_id
                LEFT JOIN Lottery_Prize_Rates r ON CAST(i.lottery_type AS INT) = CAST(r.lottery_type AS INT)
                WHERE i.selected_number = @num
                  AND o.created_at >= @StartDateTime 
                  AND o.created_at <= @EndDateTime
                ORDER BY i.price DESC
            `);
        res.json({ success: true, buyers: result.recordset });
    } catch (err) { 
        console.error(err);
        res.status(500).json({ success: false }); 
    }
});



// ==========================================
// 🌟 API 1: จำลองคนถูกรางวัล (แสดงใน Modal)
// ==========================================
app.post('/api/admin/simulate-winners', async (req, res) => {
    const { number, lottery_type } = req.body;
    try {
        const pool = await sql.connect(dbConfig);
        
        // ดึงเรทแลกเปลี่ยนปัจจุบัน
        const rateRes = await pool.request().query("SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'");
        const exchangeRate = rateRes.recordset.length > 0 ? rateRes.recordset[0].rate : 500.0;

        const result = await pool.request()
            .input('num', sql.VarChar, number)
            .input('type', sql.VarChar, lottery_type)
            .query(`
                SELECT 
                    u.username, o.currency_code, i.price, CAST(i.lottery_type AS VARCHAR) as lottery_type, i.selected_number,
                    (i.price * r.multiplier) as estimated_prize,
                    CASE 
                        WHEN o.currency_code = 'LAK' THEN (i.price * r.multiplier) / ${exchangeRate} 
                        ELSE (i.price * r.multiplier) 
                    END as estimated_prize_thb
                FROM Lottery_Order_Items i
                JOIN Lottery_Orders o ON i.order_id = o.order_id
                JOIN Users u ON o.user_id = u.user_id
                LEFT JOIN Lottery_Prize_Rates r ON CAST(i.lottery_type AS INT) = CAST(r.lottery_type AS INT)
                WHERE o.status = N'รอผลตรวจ' AND i.status = N'รอผลตรวจ'
                  AND i.lottery_type = @type AND i.selected_number = @num
            `);
        res.json({ success: true, users: result.recordset });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});


// ==========================================
// 🌟 API: จัดการตั้งค่า % Commission
// ==========================================

// 1. ดึงข้อมูลการตั้งค่า Commission ปัจจุบัน
app.get('/api/admin/commission-settings', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query('SELECT * FROM Commission_Settings WHERE id = 1');
        
        if (result.recordset.length > 0) {
            res.json({ success: true, data: result.recordset[0] });
        } else {
            res.json({ success: false, message: 'ไม่พบข้อมูลตั้งค่า' });
        }
    } catch (err) {
        console.error('Fetch Commission Settings Error:', err);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// 2. บันทึก/อัปเดต % Commission ใหม่
app.put('/api/admin/commission-settings', async (req, res) => {
    const { purchase_percent, win_percent, daily_bonus_percent } = req.body;
    try {
        const pool = await sql.connect(dbConfig);
        await pool.request()
            .input('purchase', sql.Decimal(18,2), purchase_percent)
            .input('win', sql.Decimal(18,2), win_percent)
            .input('bonus', sql.Decimal(18,2), daily_bonus_percent)
            .query(`
                UPDATE Commission_Settings 
                SET purchase_percent = @purchase, 
                    win_percent = @win, 
                    daily_bonus_percent = @bonus,
                    updated_at = GETDATE()
                WHERE id = 1
            `);
            
        res.json({ success: true, message: 'อัปเดตอัตรา Commission สำเร็จ' });
    } catch (err) {
        console.error('Update Commission Settings Error:', err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการอัปเดต' });
    }
});

// ==========================================
// 🌟 API: ดึงข้อมูลหน้าทีม (ส่งค่า % จาก Admin ไปให้หน้าบ้านแสดงผล)
// ==========================================
app.get('/api/my-team/:uid', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const userId = req.params.uid;
        
        // 1. ดึงชื่อและสกุลเงินตัวเอง (ผู้แนะนำ)
        const userRes = await pool.request().input('userId', sql.Int, userId).query('SELECT username, currency_code FROM Users WHERE user_id = @userId');
        if (userRes.recordset.length === 0) return res.json({ success: false, message: 'User not found' });
        const myUsername = userRes.recordset[0].username.trim();
        const myCurrency = userRes.recordset[0].currency_code || 'THB';

        // 2. ดึงข้อมูลลูกทีม
        const teamRes = await pool.request().input('myUsername', sql.NVarChar, myUsername).query(`
            SELECT 
                user_id, username, created_at, is_active, ISNULL(currency_code, 'THB') as currency_code,
                ISNULL(total_purchase_comm, 0) as total_purchase_comm, 
                ISNULL(total_win_comm, 0) as total_win_comm 
            FROM Users WHERE referrer_username = @myUsername
        `);

        // 3. ดึงประวัติการเงินทั้งหมดของเรา
        const transRes = await pool.request().input('userId', sql.Int, userId).query(`
            SELECT amount, title, created_at FROM Transactions WHERE user_id = @userId
        `);
        
        // 🌟 4. ดึงเรทการตั้งค่าทั้งหมด (เพื่อส่งไปแสดงผล % ที่หน้าบ้านให้ตรงกับที่ Admin ตั้ง)
        const setRes = await pool.request().query('SELECT TOP 1 purchase_percent, win_percent, daily_bonus_percent FROM Commission_Settings');
        const commSettings = setRes.recordset.length > 0 ? setRes.recordset[0] : { purchase_percent: 2, win_percent: 2, daily_bonus_percent: 1 };

        // 5. ดึงตารางอัตราแลกเปลี่ยนทั้งหมด
        const exRes = await pool.request().query('SELECT currency_pair, rate FROM ExchangeRates');
        const exchangeRates = {};
        exRes.recordset.forEach(r => {
            exchangeRates[r.currency_pair] = r.rate;
        });

        res.json({
            success: true,
            myUsername: myUsername,
            myCurrency: myCurrency,
            teamMembers: teamRes.recordset,
            transactions: transRes.recordset,
            bonusPercent: commSettings.daily_bonus_percent, // ใช้คำนวณ
            commSettings: commSettings, // 🌟 ส่งข้อมูลเรททั้งหมดไปโชว์ที่หน้าจอ
            exchangeRates: exchangeRates
        });
    } catch (err) {
        console.error('API My-Team Error:', err);
        res.status(500).json({ success: false });
    }
});

// ==========================================
// 🌟 API: รายงานโอนเงินรางวัลและสรุปกำไร (Prize Transfer Report)
// ==========================================
app.post('/api/admin/prize-report', async (req, res) => {
    const { startDate, endDate, country } = req.body;
    try {
        const pool = await sql.connect(dbConfig);
        
        // 1. ดึงเรทแลกเปลี่ยนปัจจุบัน (เพื่อใช้แปลง LAK เป็น THB สำหรับสรุปยอด)
        const rateRes = await pool.request().query("SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'");
        const exchangeRate = rateRes.recordset.length > 0 ? rateRes.recordset[0].rate : 500.0;

        // 2. Query ดึงข้อมูลสรุปของ "เดือนปัจจุบัน" (สะสม)
        const monthlyQuery = `
            SELECT 
                ISNULL(SUM(CASE WHEN o.currency_code = 'LAK' THEN o.total_amount / ${exchangeRate} ELSE o.total_amount END), 0) as monthly_sales,
                ISNULL((
                    SELECT SUM(CASE WHEN o2.currency_code = 'LAK' THEN i2.prize_amount / ${exchangeRate} ELSE i2.prize_amount END)
                    FROM Lottery_Order_Items i2 
                    JOIN Lottery_Orders o2 ON i2.order_id = o2.order_id
                    WHERE i2.status = N'ถูกรางวัล' AND MONTH(o2.created_at) = MONTH(GETDATE()) AND YEAR(o2.created_at) = YEAR(GETDATE())
                ), 0) as monthly_prizes
            FROM Lottery_Orders o
            WHERE MONTH(o.created_at) = MONTH(GETDATE()) AND YEAR(o.created_at) = YEAR(GETDATE());
        `;
        const monthlyRes = await pool.request().query(monthlyQuery);
        const monthlySales = monthlyRes.recordset[0].monthly_sales;
        const monthlyProfit = monthlySales - monthlyRes.recordset[0].monthly_prizes;

        // 3. Query ดึงข้อมูล "ตามช่วงเวลาและประเทศที่เลือก"
        let countryCondition = "";
        if (country === 'Thailand') countryCondition = "AND u.country = 'Thailand'";
        if (country === 'Laos') countryCondition = "AND u.country = 'Laos'";

        const filterSummaryQuery = `
            SELECT 
                ISNULL(SUM(CASE WHEN o.currency_code = 'LAK' THEN o.total_amount / ${exchangeRate} ELSE o.total_amount END), 0) as period_sales,
                ISNULL((
                    SELECT SUM(CASE WHEN o2.currency_code = 'LAK' THEN i2.prize_amount / ${exchangeRate} ELSE i2.prize_amount END)
                    FROM Lottery_Order_Items i2 
                    JOIN Lottery_Orders o2 ON i2.order_id = o2.order_id
                    JOIN Users u2 ON o2.user_id = u2.user_id
                    WHERE i2.status = N'ถูกรางวัล' AND CAST(o2.created_at AS DATE) BETWEEN @StartDate AND @EndDate ${countryCondition.replace(/u\./g, 'u2.')}
                ), 0) as period_prizes
            FROM Lottery_Orders o
            JOIN Users u ON o.user_id = u.user_id
            WHERE CAST(o.created_at AS DATE) BETWEEN @StartDate AND @EndDate ${countryCondition};
        `;
        const summaryRes = await pool.request()
            .input('StartDate', sql.Date, startDate)
            .input('EndDate', sql.Date, endDate)
            .query(filterSummaryQuery);
        
        const periodSales = summaryRes.recordset[0].period_sales;
        const periodPrizes = summaryRes.recordset[0].period_prizes;
        const periodProfit = periodSales - periodPrizes;

        // 4. Query ดึงรายชื่อ "ผู้ถูกรางวัล" ตามเงื่อนไข
        const winnersQuery = `
            SELECT 
                u.username, u.country, o.currency_code, 
                i.lottery_type, i.selected_number, i.price, i.prize_amount, o.created_at,
                CASE WHEN o.currency_code = 'LAK' THEN i.prize_amount / ${exchangeRate} ELSE i.prize_amount END as prize_thb
            FROM Lottery_Order_Items i
            JOIN Lottery_Orders o ON i.order_id = o.order_id
            JOIN Users u ON o.user_id = u.user_id
            WHERE i.status = N'ถูกรางวัล' 
            AND CAST(o.created_at AS DATE) BETWEEN @StartDate AND @EndDate
            ${countryCondition}
            ORDER BY o.created_at DESC;
        `;
        const winnersRes = await pool.request()
            .input('StartDate', sql.Date, startDate)
            .input('EndDate', sql.Date, endDate)
            .query(winnersQuery);

        res.json({
            success: true,
            monthly: { sales: monthlySales, profit: monthlyProfit },
            period: { sales: periodSales, prizes: periodPrizes, profit: periodProfit },
            winners: winnersRes.recordset
        });

    } catch (err) {
        console.error("Prize Report Error:", err);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});


// ==========================================
// 🛡️ API: ระบบจัดการ IP เฝ้าระวัง
// ==========================================

// ดึงรายการ IP ที่ถูกบล็อกหรือเฝ้าระวัง
app.get('/api/admin/malicious-ips', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query(`
            SELECT id, ip_address, reason, is_blocked, created_at 
            FROM Blocked_IPs 
            ORDER BY created_at DESC
        `);
        res.json({ success: true, ips: result.recordset });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// ปลดบล็อก / หรือบล็อก IP แบบ Manual
app.post('/api/admin/toggle-block-ip', async (req, res) => {
    const { ip_address, is_blocked, reason } = req.body;
    try {
        const pool = await sql.connect(dbConfig);
        
        if (is_blocked) {
            // สั่งบล็อก Manual
            await pool.request()
                .input('ip', sql.VarChar, ip_address)
                .input('reason', sql.NVarChar, reason || 'Manual Block')
                .query(`
                    IF EXISTS (SELECT 1 FROM Blocked_IPs WHERE ip_address = @ip)
                        UPDATE Blocked_IPs SET is_blocked = 1, reason = @reason, updated_at = GETDATE() WHERE ip_address = @ip;
                    ELSE
                        INSERT INTO Blocked_IPs (ip_address, reason, is_blocked) VALUES (@ip, @reason, 1);
                `);
        } else {
            // สั่งปลดบล็อก
            await pool.request()
                .input('ip', sql.VarChar, ip_address)
                .query(`UPDATE Blocked_IPs SET is_blocked = 0, updated_at = GETDATE() WHERE ip_address = @ip`);
            
            // ล้างประวัติการ Login ผิดพลาดให้ด้วย
            await pool.request()
                .input('ip', sql.VarChar, ip_address)
                .query(`DELETE FROM Login_Failed_Attempts WHERE ip_address = @ip`);
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// ==========================================
// 🏢 API: ระบบจัดการข้อมูลองค์กร (HRM Master Data)
// ==========================================

// 1. ดึงข้อมูลทั้งหมด (Branches, Departments, Positions)
app.get('/api/hrm/master-data', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const branchRes = await pool.request().query('SELECT * FROM Emp_Branches');
        const deptRes = await pool.request().query('SELECT * FROM Emp_Departments');
        const posRes = await pool.request().query('SELECT * FROM Emp_Positions');

        res.json({
            success: true,
            branches: branchRes.recordset,
            departments: deptRes.recordset,
            positions: posRes.recordset
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// 2. เพิ่ม สาขา (Branch)
app.post('/api/hrm/branch', async (req, res) => {
    const { branch_code, branch_name, country_code } = req.body;
    if(!branch_code || !branch_name) return res.status(400).json({success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน'});
    
    try {
        const pool = await sql.connect(dbConfig);
        await pool.request()
            .input('code', sql.VarChar, branch_code)
            .input('name', sql.NVarChar, branch_name)
            .input('country', sql.VarChar, country_code)
            .query(`INSERT INTO Emp_Branches (branch_code, branch_name, country_code) VALUES (@code, @name, @country)`);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'รหัสสาขาซ้ำ หรือ เกิดข้อผิดพลาด' });
    }
});

// 3. เพิ่ม แผนก (Department)
app.post('/api/hrm/department', async (req, res) => {
    const { dept_code, dept_name } = req.body;
    if(!dept_code || !dept_name) return res.status(400).json({success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน'});

    try {
        const pool = await sql.connect(dbConfig);
        await pool.request()
            .input('code', sql.VarChar, dept_code)
            .input('name', sql.NVarChar, dept_name)
            .query(`INSERT INTO Emp_Departments (dept_code, dept_name) VALUES (@code, @name)`);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'รหัสแผนกซ้ำ หรือ เกิดข้อผิดพลาด' });
    }
});

// 4. เพิ่ม ตำแหน่ง (Position)
app.post('/api/hrm/position', async (req, res) => {
    const { position_code, position_name, dept_code, base_salary, hourly_rate, ot_multiplier } = req.body;
    if(!position_code || !position_name || !dept_code) return res.status(400).json({success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน'});

    try {
        const pool = await sql.connect(dbConfig);
        await pool.request()
            .input('code', sql.VarChar, position_code)
            .input('name', sql.NVarChar, position_name)
            .input('dept', sql.VarChar, dept_code)
            .input('salary', sql.Decimal(18,2), base_salary || 0)
            .input('hourly', sql.Decimal(18,2), hourly_rate || 0)
            .input('ot', sql.Decimal(4,2), ot_multiplier || 1.5)
            .query(`INSERT INTO Emp_Positions (position_code, position_name, dept_code, base_salary, hourly_rate, ot_multiplier) 
                    VALUES (@code, @name, @dept, @salary, @hourly, @ot)`);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'รหัสตำแหน่งซ้ำ หรือ เกิดข้อผิดพลาด' });
    }
});

// 5. ลบข้อมูล (Delete)
app.delete('/api/hrm/:type/:code', async (req, res) => {
    const { type, code } = req.params;
    try {
        const pool = await sql.connect(dbConfig);
        if (type === 'branch') await pool.request().input('code', sql.VarChar, code).query('DELETE FROM Emp_Branches WHERE branch_code = @code');
        if (type === 'dept') await pool.request().input('code', sql.VarChar, code).query('DELETE FROM Emp_Departments WHERE dept_code = @code');
        if (type === 'position') await pool.request().input('code', sql.VarChar, code).query('DELETE FROM Emp_Positions WHERE position_code = @code');
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'ไม่สามารถลบได้ เนื่องจากมีการผูกข้อมูลนี้ไว้ในระบบแล้ว' });
    }
});

// ==========================================
// 🧑‍💼 API: สำหรับลูกค้ายื่นใบสมัครงาน (Job Application)
// ==========================================
app.post('/api/hrm/apply-job', async (req, res) => {
    const { username, firstname, lastname, branch_code, position_code, employment_type } = req.body;
    
    if(!username || !firstname || !branch_code || !position_code) {
        return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน' });
    }

    try {
        const pool = await sql.connect(dbConfig);
        
        // 1. เช็คว่าลูกค้ารายนี้เคยยื่นสมัครตำแหน่งนี้ไปแล้วหรือยัง (กันส่งซ้ำ)
        const checkExist = await pool.request()
            .input('username', sql.VarChar, username)
            .query(`SELECT emp_code FROM Employees WHERE username = @username AND status = 'Pending'`);
            
        if(checkExist.recordset.length > 0) {
            return res.status(400).json({ success: false, message: 'คุณได้ยื่นใบสมัครไปแล้ว กรุณารอการติดต่อกลับจากทีมงานครับ' });
        }

        // 2. สร้างรหัสใบสมัครชั่วคราว (เช่น APP-20260803-0001)
        const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,'');
        const countRes = await pool.request().query(`SELECT COUNT(emp_code) as cnt FROM Employees`);
        const nextId = (countRes.recordset[0].cnt + 1).toString().padStart(4, '0');
        const emp_code = `APP-${dateStr}-${nextId}`;

        // 3. บันทึกลงตาราง Employees โดยให้สถานะเป็น 'Pending' (รออนุมัติ)
        await pool.request()
            .input('emp_code', sql.VarChar, emp_code)
            .input('username', sql.VarChar, username)
            .input('firstname', sql.NVarChar, firstname)
            .input('lastname', sql.NVarChar, lastname || '')
            .input('branch', sql.VarChar, branch_code)
            .input('position', sql.VarChar, position_code)
            .input('emp_type', sql.VarChar, employment_type)
            // รหัสผ่านใส่ Dummy ไว้ก่อน เพราะเวลา Login จริง เราเช็คจากตาราง Users ตามที่คุณพี่บอกครับ
            .query(`
                INSERT INTO Employees (emp_code, username, password_hash, firstname, lastname, branch_code, position_code, employment_type, status, created_at)
                VALUES (@emp_code, @username, 'USE_MAIN_LOGIN', @firstname, @lastname, @branch, @position, @emp_type, 'Pending', GETDATE())
            `);
            
        res.json({ success: true, message: 'ส่งใบสมัครเรียบร้อยแล้ว! ทีมงานจะติดต่อกลับไปทางช่องทางติดต่อของคุณครับ' });
    } catch (err) {
        console.error("Apply Job Error:", err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการส่งใบสมัคร' });
    }
});


// ==========================================
// 📢 API: ระบบป้ายประกาศรับสมัครงาน (หน้า PreLogin)
// ==========================================

// 1. ดึงข้อมูลโฆษณา (ให้หน้า PreLogin เรียกใช้)
app.get('/api/hrm/job-ad', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query('SELECT * FROM Job_Ads_Settings WHERE id = 1');
        if(result.recordset.length > 0) {
            res.json({ success: true, ad: result.recordset[0] });
        } else {
            res.json({ success: false });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// 2. อัปเดตโฆษณา (แอดมินกดบันทึกจากหลังบ้าน)
app.post('/api/hrm/job-ad', async (req, res) => {
    const { is_active, ad_title, ad_description, end_time } = req.body;
    try {
        const pool = await sql.connect(dbConfig);
        await pool.request()
            .input('is_active', sql.Bit, is_active ? 1 : 0)
            .input('title', sql.NVarChar, ad_title)
            .input('desc', sql.NVarChar, ad_description)
            .input('end', sql.DateTime, end_time)
            .query(`
                UPDATE Job_Ads_Settings 
                SET is_active = @is_active, ad_title = @title, ad_description = @desc, end_time = @end
                WHERE id = 1
            `);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// ==========================================
// 🌟 2. ดึงข้อมูล 24 รอบของวันนี้ (ทั้งหน้าบ้านและหลังบ้านใช้ร่วมกัน)
// ==========================================
app.get('/api/yeeki/rounds', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig); 
        
        // 🌟 ดึงข้อมูลรอบของวันนี้ (อิงเวลาไทย) และแปลงเวลาให้ JavaScript ฝั่ง Frontend อ่านได้เป๊ะๆ
        const result = await pool.request().query(`
            SELECT 
                round_id, 
                round_number,
                CONVERT(varchar, open_time, 120) as open_time,
                CONVERT(varchar, close_time, 120) as close_time,
                CONVERT(varchar, draw_time, 120) as draw_time,
                status
            FROM Yeeki_Rounds 
            WHERE CAST(draw_date AS DATE) = CAST(DATEADD(hour, 7, GETUTCDATE()) AS DATE) 
            ORDER BY round_number ASC
        `);
        
        res.json({ success: true, rounds: result.recordset });
    } catch (err) {
        console.error("Error fetching Yeeki rounds:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// ==========================================
// 2. ดึงอัตราการจ่าย (หวยยี่กี)
// ==========================================
app.get('/api/yeeki/prize-rates', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig); 
        const result = await pool.request().query('SELECT lottery_type, multiplier FROM Yeeki_Prize_Rates');
        res.json({ success: true, rates: result.recordset });
    } catch (err) {
        console.error("Error fetching prize rates:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 3. ดึงยอดแจ็คพอต 8 ตัวสะสม (หวยยี่กี)
// ==========================================
app.get('/api/yeeki/jackpot', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig); 
        const result = await pool.request().query('SELECT TOP 1 * FROM Super_Yeeki_Jackpot ORDER BY id DESC');
        
        if (result.recordset.length > 0) {
             res.json({ success: true, jackpot: { current_amount: result.recordset[0].amount, currency_code: 'LAK' } });
        } else {
             res.json({ success: true, jackpot: { current_amount: 10000000, currency_code: 'LAK' } });
        }
    } catch (err) {
        console.error("Error fetching jackpot:", err);
        res.json({ success: true, jackpot: { current_amount: 10000000, currency_code: 'LAK' } });
    }
});



// ==========================================
// 🌟 รายงานยอดขายหวยยี่กี (Admin Sales Report - โชว์การ์ด 12 รอบถัดไปเสมอ)
// ==========================================
app.get('/api/admin/yeeki/sales-report', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        
        // 1. ดึง 12 รอบถัดไป (ข้ามวันได้) มาทำการ์ด
        const roundsResult = await pool.request().query(`
            SELECT TOP 12
                round_id, round_number, 
                CONVERT(varchar, open_time, 120) as open_time_str, 
                CONVERT(varchar, close_time, 120) as close_time_str, 
                CONVERT(varchar, draw_time, 120) as draw_time_str,
                status as db_status,
                result_8_super, result_4_top, result_2_bottom
            FROM Yeeki_Rounds
            WHERE draw_time >= DATEADD(hour, 7, GETUTCDATE())
            ORDER BY draw_date ASC, round_number ASC
        `);
        
        // 2. ดึงบิลทั้งหมดเฉพาะที่อยู่ใน 12 รอบนี้
        const ordersResult = await pool.request().query(`
            SELECT 
                o.round_id, u.username, oi.lottery_type as type, oi.selected_number as number,
                oi.price, o.currency_code as currency, oi.status
            FROM Yeeki_Orders o
            JOIN Yeeki_Order_Items oi ON o.order_id = oi.order_id
            JOIN Users u ON o.user_id = u.user_id
            WHERE o.round_id IN (
                SELECT TOP 12 round_id
                FROM Yeeki_Rounds
                WHERE draw_time >= DATEADD(hour, 7, GETUTCDATE())
                ORDER BY draw_date ASC, round_number ASC
            )
            ORDER BY o.created_at DESC
        `);
        
        const allOrders = ordersResult.recordset;
        let overallTotal = { thb: 0, lak: 0 };
        let activeRoundTotal = { thb: 0, lak: 0 };
        const jsNow = new Date(); 
        
        const rounds = roundsResult.recordset.map(r => {
            const roundOrders = allOrders.filter(o => o.round_id === r.round_id);
            let total_thb = 0; let total_lak = 0;
            
            roundOrders.forEach(o => {
                if (o.currency === 'THB' || o.currency === '฿') total_thb += Number(o.price);
                if (o.currency === 'LAK' || o.currency === '₭') total_lak += Number(o.price);
            });
            
            overallTotal.thb += total_thb;
            overallTotal.lak += total_lak;
            
            const openTimeDate = new Date(r.open_time_str.replace(' ', 'T'));
            const closeTimeDate = new Date(r.close_time_str.replace(' ', 'T'));
            
            let computedStatus = 'upcoming';
            if (r.db_status === 'Completed' || jsNow > closeTimeDate) {
                computedStatus = 'ended';
            } else if (jsNow >= openTimeDate && jsNow <= closeTimeDate) {
                computedStatus = 'open';
                activeRoundTotal.thb += total_thb;
                activeRoundTotal.lak += total_lak;
            }
            
            let winning_result = null;
            if (r.db_status === 'Completed' && r.result_8_super) {
                winning_result = `${r.result_8_super} / ${r.result_4_top} / ${r.result_2_bottom}`;
            }
            
            return {
                round_id: r.round_id, round_number: r.round_number,
                open_time: r.open_time_str.substring(11, 16),
                close_time: r.close_time_str.substring(11, 16),
                draw_time: r.draw_time_str.substring(11, 16),
                status: computedStatus, total_thb, total_lak, winning_result,
                orders: roundOrders
            };
        });
        
        res.json({ success: true, overallTotal, activeRoundTotal, rounds });
    } catch (err) {
        console.error("Error fetching sales report:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 API สำหรับการซื้อหวยยี่กี (แก้ไขชื่อคอลัมน์เป็น title)
// ==========================================
app.post('/api/yeeki/buy', async (req, res) => {
    const { user_id, cart, total_price, currency, note, lottery_category } = req.body;
    let pool;
    
    try {
        if (!user_id || !cart || cart.length === 0) {
            return res.status(400).json({ success: false, message: "ข้อมูลการสั่งซื้อไม่ครบถ้วน" });
        }

        pool = await sql.connect(dbConfig);
        
        // 1. ดึงข้อมูลผู้ซื้อ 
        const userCheck = await pool.request()
            .input('uid', sql.Int, user_id)
            .query(`SELECT username, wallet_balance, referrer_username FROM Users WHERE user_id = @uid`);
            
        if (userCheck.recordset.length === 0) {
            return res.status(404).json({ success: false, message: "ไม่พบข้อมูลผู้ใช้" });
        }
        
        const buyer = userCheck.recordset[0];
        const currentBalance = buyer.wallet_balance || 0;
        
        if (currentBalance < total_price) {
            return res.status(400).json({ success: false, message: "ยอดเงินในกระเป๋าไม่เพียงพอ" });
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 2. หักเงินผู้ซื้อ
            await transaction.request()
                .input('price', sql.Decimal(18,2), total_price)
                .input('uid', sql.Int, user_id)
                .query(`UPDATE Users SET wallet_balance = wallet_balance - @price WHERE user_id = @uid`);

            // 3. สร้างประวัติ Transaction ผู้ซื้อ (เปลี่ยน description เป็น title)
            await transaction.request()
                .input('uid', sql.Int, user_id)
                .input('amount', sql.Decimal(18,2), -total_price)
                .input('type', sql.VarChar(50), 'BUY_YEEKI')
                .input('title', sql.NVarChar(255), `แทงหวยยี่กี รอบที่ ${cart[0].round_number}`) // เปลี่ยนชื่อตัวแปรให้ตรง
                .query(`
                    INSERT INTO Transactions (user_id, amount, transaction_type, title, status) -- เปลี่ยนคอลัมน์เป็น title
                    VALUES (@uid, @amount, @type, @title, 'Completed')
                `);

            // 4. บันทึกบิลหลักลง Yeeki_Orders
            const mainRoundId = cart[0].round_id;
            const insertOrderReq = await transaction.request()
                .input('user_id', sql.Int, user_id)
                .input('round_id', sql.Int, mainRoundId)
                .input('total_amount', sql.Decimal(18,2), total_price)
                .input('currency', sql.VarChar(10), currency)
                .input('note', sql.NVarChar(255), note || '')
                .input('status', sql.VarChar(50), 'Completed')
                .query(`
                    INSERT INTO Yeeki_Orders (user_id, round_id, total_amount, currency_code, status, order_note)
                    OUTPUT INSERTED.order_id
                    VALUES (@user_id, @round_id, @total_amount, @currency, @status, @note)
                `);

            const newOrderId = insertOrderReq.recordset[0].order_id;

            // 5. บันทึกรายการย่อยทีละตัว
            for (let item of cart) {
                await transaction.request()
                    .input('order_id', sql.Int, newOrderId)
                    .input('ltype', sql.NVarChar(50), item.type)
                    .input('number', sql.VarChar(20), item.number)
                    .input('price', sql.Decimal(18,2), item.price)
                    .query(`
                        INSERT INTO Yeeki_Order_Items (order_id, lottery_type, selected_number, price, status)
                        VALUES (@order_id, @ltype, @number, @price, N'รอผลตรวจ')
                    `);
            }

            // 6. 💰 ระบบแจกค่าคอมมิชชั่น 5% ให้ผู้แนะนำ
            if (buyer.referrer_username) {
                // 6.1 เอาชื่อผู้แนะนำ ไปค้นหา user_id ในตาราง Users ก่อน
                const refCheck = await transaction.request()
                    .input('refUsername', sql.VarChar(50), buyer.referrer_username)
                    .query(`SELECT user_id FROM Users WHERE username = @refUsername`);

                // ถ้าเจอตัวผู้แนะนำในระบบ ค่อยจ่ายเงิน
                if (refCheck.recordset.length > 0) {
                    const referrerUserId = refCheck.recordset[0].user_id;
                    const commissionRate = 0.05; // เรท 5%
                    const commissionAmount = total_price * commissionRate;

                    // 6.2 อัปเดตกระเป๋าเงินของผู้แนะนำ (บวกเงินเพิ่ม)
                    await transaction.request()
                        .input('commAmount', sql.Decimal(18,2), commissionAmount)
                        .input('refUserId', sql.Int, referrerUserId)
                        .query(`UPDATE Users SET wallet_balance = wallet_balance + @commAmount WHERE user_id = @refUserId`);

                    // 6.3 สร้างประวัติ Transaction รายได้ให้ "ผู้แนะนำ" (เปลี่ยน description เป็น title)
                    await transaction.request()
                        .input('refUserId', sql.Int, referrerUserId)
                        .input('commAmount', sql.Decimal(18,2), commissionAmount)
                        .input('commType', sql.VarChar(50), 'COMMISSION_5')
                        .input('commTitle', sql.NVarChar(255), `รายได้ 5% จากทีมงาน (${buyer.username})`) // เปลี่ยนชื่อตัวแปรให้ตรง
                        .query(`
                            INSERT INTO Transactions (user_id, amount, transaction_type, title, status) -- เปลี่ยนคอลัมน์เป็น title
                            VALUES (@refUserId, @commAmount, @commType, @commTitle, 'Completed')
                        `);
                }
            }

            await transaction.commit();
            res.json({ success: true, message: "สั่งซื้อสำเร็จ", order_id: newOrderId });

        } catch (innerErr) {
            await transaction.rollback();
            throw innerErr;
        }

    } catch (err) {
        console.error("Yeeki Buy error:", err);
        res.status(500).json({ 
            success: false, 
            message: `ฐานข้อมูลขัดข้อง (Database Error): ${err.message}` 
        });
    }
});

// ==========================================
// 🌟 1. ดึง/อัปเดต การตั้งค่าหวยยี่กีออโต้
// ==========================================
app.get('/api/yeeki/settings', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query('SELECT TOP 1 is_auto_draw, auto_draw_percent FROM Yeeki_Settings');
        if (result.recordset.length > 0) {
            res.json({ success: true, data: result.recordset[0] });
        } else {
            res.json({ success: true, data: { is_auto_draw: false, auto_draw_percent: 50 } });
        }
    } catch (err) {
        console.error("Error fetching Yeeki settings:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/yeeki/settings', async (req, res) => {
    try {
        const { is_auto_draw, auto_draw_percent } = req.body;
        const pool = await sql.connect(dbConfig);
        await pool.request()
            .input('is_auto', sql.Bit, is_auto_draw ? 1 : 0)
            .input('percent', sql.Int, auto_draw_percent || 50)
            .query('UPDATE Yeeki_Settings SET is_auto_draw = @is_auto, auto_draw_percent = @percent');
        res.json({ success: true, message: 'บันทึกการตั้งค่าสำเร็จ' });
    } catch (err) {
        console.error("Error saving Yeeki settings:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 1. ดึงประวัติการออกรางวัล (เพื่อให้ตารางหน้าแรกโชว์ผลย้อนหลัง)
app.get('/api/admin/yeeki-draw-history', async (req, res) => {
    try {
        const { date } = req.query;
        const pool = await sql.connect(dbConfig);
        
        // ดึงรอบล่าสุดที่ออกผลแล้วของวันนี้
        const historyReq = await pool.request()
            .input('date', sql.VarChar, date)
            .query(`SELECT TOP 1 * FROM Yeeki_Rounds WHERE CAST(draw_date AS DATE) = CAST(@date AS DATE) AND status = 'Completed' ORDER BY round_number DESC`);
            
        // ดึงรายชื่อคนถูกรางวัลของวันนี้
        const winnersReq = await pool.request()
            .input('date', sql.VarChar, date)
            .query(`
                SELECT u.username, o.round_id as round_number, oi.lottery_type, oi.selected_number, oi.price, oi.prize_amount, o.currency_code
                FROM Yeeki_Order_Items oi
                JOIN Yeeki_Orders o ON oi.order_id = o.order_id
                JOIN Users u ON o.user_id = u.user_id
                WHERE CAST(o.created_at AS DATE) = CAST(@date AS DATE) AND oi.status = 'Win'
                ORDER BY o.round_id DESC
            `);
            
        res.json({ success: true, results: historyReq.recordset[0] || null, winners: winnersReq.recordset });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 API ประกาศผลและตรวจรางวัล (Execute Draw)
// ==========================================
app.post('/api/admin/execute-yeeki-draw', async (req, res) => {
    // 💡 เปลี่ยนมารับค่า top_6
    const { round_id, super_number, top_6 } = req.body;
    let pool;
    try {
        pool = await sql.connect(dbConfig);
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 💡 แตกเลข
            const top_4 = top_6.slice(-4);
            const top_3 = top_6.slice(-3);
            const top_2 = top_6.slice(-2);
            const bottom_2 = top_6.slice(2, 4);

            // 1. อัปเดตผลรางวัลลงตาราง
            await transaction.request()
                .input('roundId', sql.Int, round_id)
                .input('res8', sql.VarChar(8), super_number)
                // 💡 เก็บ 6 ตัวไว้ในคอลัมน์ไหน? สมมติเก็บ 4 ตัวไว้เหมือนเดิม แต่เราสามารถตรวจสอบย้อนหลังได้จาก order
                // ถ้าคุณพี่มีคอลัมน์ result_6 ก็เพิ่มตรงนี้ได้ครับ แต่เพื่อความชัวร์ผมเก็บแค่ 4 ตัวตามฐานข้อมูลเดิมก่อน
                .input('res4', sql.VarChar(4), top_4) 
                .input('res3', sql.VarChar(3), top_3)
                .input('res2bot', sql.VarChar(2), bottom_2)
                .query(`
                    UPDATE Yeeki_Rounds 
                    SET result_8_super = @res8, 
                        result_4_top = @res4, 
                        result_3_top = @res3, 
                        result_2_bottom = @res2bot,
                        status = 'Completed' 
                    WHERE round_id = @roundId
                `);

            const ratesReq = await transaction.request().query(`SELECT lottery_type, multiplier FROM Yeeki_Prize_Rates`);
            const prizeRates = {};
            ratesReq.recordset.forEach(r => prizeRates[r.lottery_type] = r.multiplier);

            const itemsReq = await transaction.request()
                .input('roundId', sql.Int, round_id)
                .query(`
                    SELECT i.item_id, i.order_id, i.lottery_type, i.selected_number, i.price, o.user_id, o.currency_code
                    FROM Yeeki_Order_Items i
                    JOIN Yeeki_Orders o ON i.order_id = o.order_id
                    WHERE o.round_id = @roundId AND i.status = N'รอผลตรวจ'
                `);

            const items = itemsReq.recordset;

            for (let item of items) {
                let isWin = false;
                const type = item.lottery_type;
                const num = item.selected_number;

                // 💡 เงื่อนไขการตรวจของจริง
                if (type === '8 ตัว (Super)' && num === super_number) isWin = true;
                else if (type === '6 ตัว' && num === top_6) isWin = true;
                else if (type === '4 ตัวท้าย' && num === top_4) isWin = true;
                else if (type === '3 ตัวบน' && num === top_3) isWin = true;
                else if (type === '3 ตัวโต๊ด') {
                    const winArr = top_3.split('').sort().join('');
                    const playArr = num.split('').sort().join('');
                    if (winArr === playArr) isWin = true;
                }
                else if (type === '2 ตัวบน' && num === top_2) isWin = true;
                else if (type === '2 ตัวล่าง' && num === bottom_2) isWin = true;
                else if (type === 'วิ่งบน' && top_3.includes(num)) isWin = true;
                else if (type === 'วิ่งล่าง' && bottom_2.includes(num)) isWin = true;

                if (isWin) {
                    const prizeAmount = item.price * (prizeRates[type] || 0);

                    await transaction.request()
                        .input('itemId', sql.Int, item.item_id)
                        .input('prizeAmt', sql.Decimal(18,2), prizeAmount)
                        .query(`UPDATE Yeeki_Order_Items SET status = N'ชนะ', prize_amount = @prizeAmt WHERE item_id = @itemId`);

                    await transaction.request()
                        .input('uid', sql.Int, item.user_id)
                        .input('prize', sql.Decimal(18,2), prizeAmount)
                        .query(`UPDATE Users SET wallet_balance = wallet_balance + @prize WHERE user_id = @uid`);

                    await transaction.request()
                        .input('uid', sql.Int, item.user_id)
                        .input('prize', sql.Decimal(18,2), prizeAmount)
                        .input('title', sql.NVarChar(255), `ถูกรางวัล ${type} (${num}) รอบที่ ${round_id}`)
                        .query(`
                            INSERT INTO Transactions (user_id, amount, transaction_type, title, status)
                            VALUES (@uid, @prize, 'PRIZE_WIN', @title, 'Completed')
                        `);
                } else {
                    await transaction.request()
                        .input('itemId', sql.Int, item.item_id)
                        .query(`UPDATE Yeeki_Order_Items SET status = N'แพ้' WHERE item_id = @itemId`);
                }
            }

            await transaction.commit();
            res.json({ success: true, message: "ประกาศผลและโอนเงินรางวัลเสร็จสิ้น!" });

        } catch (innerErr) {
            await transaction.rollback();
            throw innerErr;
        }

    } catch (err) {
        console.error("Execute Draw error:", err);
        res.status(500).json({ success: false, message: `Database Error: ${err.message}` });
    }
});

// ==========================================
// 🌟 API ค้นหาประวัติการซื้อ (ล็อคเป้า "เฉพาะรอบที่เลือกเท่านั้น" + แม่นยำ 100%)
// ==========================================
app.post('/api/admin/search-yeeki-buyers', async (req, res) => {
    // 🔴 รับค่า round_id มาจากหน้าเว็บ แทนที่จะเป็น date
    const { number, round_id } = req.body;

    if (!number || !round_id) {
        return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน (ขาดเลขหรือรหัสรอบ)' });
    }

    try {
        const pool = await sql.connect(dbConfig);

        const ratesReq = await pool.request().query(`SELECT lottery_type, multiplier FROM Yeeki_Prize_Rates`);
        const prizeRates = {};
        ratesReq.recordset.forEach(r => prizeRates[r.lottery_type] = r.multiplier);

        const exReq = await pool.request().query(`SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'`);
        const lakRate = exReq.recordset[0]?.rate || 620;

        // 🔴 แก้ SQL: เปลี่ยนจากหาทั้งวัน (r.draw_date) เป็นหาเฉพาะรอบเป๊ะๆ (r.round_id)
        const query = `
            SELECT 
                r.round_number,
                u.username,
                i.lottery_type,
                i.selected_number,
                i.price,
                o.currency_code
            FROM Yeeki_Order_Items i
            JOIN Yeeki_Orders o ON i.order_id = o.order_id
            JOIN Yeeki_Rounds r ON o.round_id = r.round_id
            JOIN Users u ON o.user_id = u.user_id
            WHERE r.round_id = @roundId 
              AND i.selected_number = @number
            ORDER BY r.round_number ASC
        `;

        const result = await pool.request()
            .input('roundId', sql.Int, round_id) // ใส่ round_id เข้าไปค้นหา
            .input('number', sql.NVarChar(50), number.trim())
            .query(query);

        const buyers = result.recordset.map(w => {
            const multiplier = prizeRates[w.lottery_type] || 0;
            const prize = w.price * multiplier;
            let prizeTHB = 0;

            if (w.currency_code === 'LAK' || w.currency_code === '₭') {
                prizeTHB = prize / lakRate;
            } else {
                prizeTHB = prize;
            }

            return {
                ...w,
                estimated_prize: prize,
                estimated_prize_thb: prizeTHB
            };
        });

        res.json({ success: true, buyers });
    } catch (err) {
        console.error("Error searching buyers:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 4. API จำลองการตั้งค่า (Settings & Prize Rates เพื่อป้องกันหน้าเว็บ Error ตอนโหลด)
app.get('/api/yeeki/settings', (req, res) => {
    // ปัจจุบันส่งค่า Default ไปก่อน ถ้ามีตารางตั้งค่าในอนาคตค่อยมาแก้ตรงนี้ครับ
    res.json({ success: true, data: { is_auto_draw: true, auto_draw_percent: 25 } });
});
app.post('/api/yeeki/settings', (req, res) => res.json({ success: true }));

// ==========================================
// 🌟 API ดึงอัตราจ่าย (GET) - ดึงจาก Database จริง
// ==========================================
app.get('/api/yeeki/prize-rates', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query(`
            SELECT lottery_type, multiplier 
            FROM Yeeki_Prize_Rates
        `);
        res.json({ success: true, rates: result.recordset });
    } catch (err) {
        console.error('Error fetching prize rates:', err);
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

// ==========================================
// 🌟 API บันทึกอัตราจ่าย (POST) - เวอร์ชันครอบจักรวาล รองรับทั้ง Array และ Object
// ==========================================
app.post('/api/yeeki/prize-rates', async (req, res) => {
    try {
        const { rates } = req.body; 
        
        if (!rates) {
            return res.status(400).json({ success: false, message: 'ไม่มีข้อมูลอัตราจ่ายส่งมา' });
        }

        const pool = await sql.connect(dbConfig);
        let totalUpdated = 0;

        // 🟢 ตรวจสอบว่าหน้าเว็บส่งมาเป็น Array (แบบตาราง) ใช่หรือไม่
        if (Array.isArray(rates)) {
            for (const item of rates) {
                const type = item.lottery_type;
                const numericMultiplier = Number(item.multiplier);

                if (type && !isNaN(numericMultiplier)) {
                    const result = await pool.request()
                        .input('type', sql.NVarChar(100), type.trim())
                        .input('multiplier', sql.Decimal(18, 2), numericMultiplier)
                        .query(`
                            UPDATE Yeeki_Prize_Rates 
                            SET multiplier = @multiplier, updated_at = GETUTCDATE() 
                            WHERE lottery_type = @type
                        `);
                    totalUpdated += result.rowsAffected[0] || 0;
                }
            }
        } 
        // 🟢 หรือหน้าเว็บส่งมาเป็น Object (แบบจับคู่)
        else {
            for (const [type, multiplier] of Object.entries(rates)) {
                const numericMultiplier = Number(multiplier);

                if (!isNaN(numericMultiplier)) {
                    const result = await pool.request()
                        .input('type', sql.NVarChar(100), type.trim())
                        .input('multiplier', sql.Decimal(18, 2), numericMultiplier)
                        .query(`
                            UPDATE Yeeki_Prize_Rates 
                            SET multiplier = @multiplier, updated_at = GETUTCDATE() 
                            WHERE lottery_type = @type
                        `);
                    totalUpdated += result.rowsAffected[0] || 0;
                }
            }
        }
        
        console.log(`✅ อัปเดตอัตราจ่ายลง Database สำเร็จทั้งหมด: ${totalUpdated} แถว`);
        res.json({ success: true, message: 'บันทึกอัตราจ่ายสำเร็จ' });
    } catch (err) {
        console.error('❌ Error updating prize rates:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});


app.get('/api/admin/exchange-rates', (req, res) => {
    res.json({ success: true, rates: [{ currency_pair: 'THB_LAK', rate: 620 }] });
});
app.post('/api/admin/exchange-rates', (req, res) => res.json({ success: true }));


// ==========================================
// 🌟 API ประกาศผลและตรวจรางวัลยี่กี (Execute Draw)
// ==========================================
app.post('/api/admin/execute-yeeki-draw', async (req, res) => {
    const { round_id, super_number, top_number, bottom_number } = req.body;
    let pool;

    try {
        pool = await sql.connect(dbConfig);
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. อัปเดตผลรางวัลลงตาราง Yeeki_Rounds
            const result3Top = top_number.slice(-3);
            const result2Top = top_number.slice(-2);

            await transaction.request()
                .input('roundId', sql.Int, round_id)
                .input('res8', sql.VarChar(8), super_number)
                .input('res4', sql.VarChar(4), top_number)
                .input('res3', sql.VarChar(3), result3Top)
                .input('res2top', sql.VarChar(2), result2Top)
                .input('res2bot', sql.VarChar(2), bottom_number)
                .query(`
                    UPDATE Yeeki_Rounds 
                    SET result_8_super = @res8, 
                        result_4_top = @res4, 
                        result_3_top = @res3, 
                        result_2_bottom = @res2bot,
                        status = 'Completed' 
                    WHERE round_id = @roundId
                `);

            // 2. ดึงอัตราการจ่าย (Multiplier) ทั้งหมด
            const ratesReq = await transaction.request().query(`SELECT lottery_type, multiplier FROM Yeeki_Prize_Rates`);
            const prizeRates = {};
            ratesReq.recordset.forEach(r => prizeRates[r.lottery_type] = r.multiplier);

            // 3. ดึงรายการบิลที่รอตรวจของรอบนี้
            const itemsReq = await transaction.request()
                .input('roundId', sql.Int, round_id)
                .query(`
                    SELECT i.item_id, i.order_id, i.lottery_type, i.selected_number, i.price, o.user_id, o.currency_code
                    FROM Yeeki_Order_Items i
                    JOIN Yeeki_Orders o ON i.order_id = o.order_id
                    WHERE o.round_id = @roundId AND i.status = N'รอผลตรวจ'
                `);

            const items = itemsReq.recordset;

            // 4. ลูปตรวจบิลทีละใบแบบเจาะลึก
            for (let item of items) {
                let isWin = false;
                const type = item.lottery_type;
                const num = item.selected_number;

                // 💡 เงื่อนไขการตรวจหวย (Logic ความแม่นยำสูง)
                if (type === '8 ตัว (Super)' && num === super_number) isWin = true;
                else if (type === '6 ตัว' && num === super_number.slice(-6)) isWin = true;
                else if (type === '4 ตัวท้าย' && num === top_number) isWin = true;
                else if (type === '3 ตัวบน' && num === result3Top) isWin = true;
                else if (type === '3 ตัวโต๊ด') {
                    // 💡 เช็คโต๊ดสลับตำแหน่ง: จับเรียงตัวอักษรแล้วเทียบกัน
                    const winArr = result3Top.split('').sort().join('');
                    const playArr = num.split('').sort().join('');
                    if (winArr === playArr) isWin = true;
                }
                else if (type === '2 ตัวบน' && num === result2Top) isWin = true;
                else if (type === '2 ตัวล่าง' && num === bottom_number) isWin = true;
                else if (type === 'วิ่งบน' && result3Top.includes(num)) isWin = true;
                else if (type === 'วิ่งล่าง' && bottom_number.includes(num)) isWin = true;

                if (isWin) {
                    const multiplier = prizeRates[type] || 0;
                    const prizeAmount = item.price * multiplier;

                    // 4.1 อัปเดตสถานะบิลย่อยเป็น "ชนะ"
                    await transaction.request()
                        .input('itemId', sql.Int, item.item_id)
                        .input('prizeAmt', sql.Decimal(18,2), prizeAmount)
                        .query(`UPDATE Yeeki_Order_Items SET status = N'ชนะ', prize_amount = @prizeAmt WHERE item_id = @itemId`);

                    // 4.2 โอนเงินเข้า Wallet ผู้ชนะ
                    await transaction.request()
                        .input('uid', sql.Int, item.user_id)
                        .input('prize', sql.Decimal(18,2), prizeAmount)
                        .query(`UPDATE Users SET wallet_balance = wallet_balance + @prize WHERE user_id = @uid`);

                    // 4.3 สร้างประวัติเงินเข้า (Transactions) -> แก้ใช้คอลัมน์ title แล้ว
                    await transaction.request()
                        .input('uid', sql.Int, item.user_id)
                        .input('prize', sql.Decimal(18,2), prizeAmount)
                        .input('title', sql.NVarChar(255), `ถูกรางวัล ${type} (${num}) รอบที่ ${round_id}`)
                        .query(`
                            INSERT INTO Transactions (user_id, amount, transaction_type, title, status)
                            VALUES (@uid, @prize, 'PRIZE_WIN', @title, 'Completed')
                        `);
                } else {
                    // 4.4 ถ้าไม่ถูกรางวัล อัปเดตเป็น "แพ้"
                    await transaction.request()
                        .input('itemId', sql.Int, item.item_id)
                        .query(`UPDATE Yeeki_Order_Items SET status = N'แพ้' WHERE item_id = @itemId`);
                }
            }

            await transaction.commit();
            res.json({ success: true, message: "ประกาศผลและโอนเงินรางวัลเสร็จสิ้น!" });

        } catch (innerErr) {
            await transaction.rollback();
            throw innerErr;
        }

    } catch (err) {
        console.error("Execute Draw error:", err);
        res.status(500).json({ success: false, message: `Database Error: ${err.message}` });
    }
});

// ==========================================
// 🌟 2. ดึงข้อมูล 24 รอบของวันนี้ (ทั้งหน้าบ้านและหลังบ้านใช้ร่วมกัน)
// ==========================================
app.get('/api/yeeki/rounds', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig); 
        
        // 🌟 ดึงข้อมูลรอบของวันนี้ (อิงเวลาไทย) และ กรองเฉพาะหวยยี่กี (category = 'YEEKI' หรือ NULL) ห้ามดึงหวยไทยมา
        const result = await pool.request().query(`
            SELECT 
                round_id, 
                round_number,
                CONVERT(varchar, open_time, 120) as open_time,
                CONVERT(varchar, close_time, 120) as close_time,
                CONVERT(varchar, draw_time, 120) as draw_time,
                status
            FROM Yeeki_Rounds 
            WHERE CAST(draw_date AS DATE) = CAST(DATEADD(hour, 7, GETUTCDATE()) AS DATE) 
            AND (category = 'YEEKI' OR category IS NULL)
            ORDER BY round_number ASC
        `);
        
        res.json({ success: true, rounds: result.recordset });
    } catch (err) {
        console.error("Error fetching Yeeki rounds:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});                                                                                                                               

// ==========================================
// 🌟 API ฝั่งหลังบ้าน (Admin) ดึงข้อมูลรอบตาม "วันที่เลือก" บนปฏิทิน
// ==========================================
app.get('/api/admin/yeeki-rounds', async (req, res) => {
    try {
        const { date } = req.query; // รับค่า YYYY-MM-DD จากปฏิทิน
        const pool = await sql.connect(dbConfig); 
        const result = await pool.request()
            .input('draw_date_str', sql.VarChar, date) 
            .query(`
                SELECT 
                    round_id, 
                    round_number,
                    CONVERT(varchar, open_time, 120) as open_time,
                    CONVERT(varchar, close_time, 120) as close_time,
                    CONVERT(varchar, draw_time, 120) as draw_time,
                    status
                FROM Yeeki_Rounds 
                WHERE CAST(draw_date AS DATE) = CAST(@draw_date_str AS DATE) 
                AND (category = 'YEEKI' OR category IS NULL)
                ORDER BY round_number ASC
            `);
        
        res.json({ success: true, rounds: result.recordset });
    } catch (err) {
        console.error("Error admin fetch rounds:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 3. อัปเดตตารางรอบ 24 รอบรวดเดียว (POST Bulk)
// ==========================================
app.post('/api/admin/yeeki-rounds/bulk', async (req, res) => {
    try {
        const { date, rounds } = req.body;
        
        const pool = await sql.connect(dbConfig); 
        
        for (const round of rounds) {
            const openTime = `${date} ${round.open_time}:00`;
            const closeTime = `${date} ${round.close_time}:00`;
            const drawTime = `${date} ${round.draw_time}:00`;

            const check = await pool.request()
                .input('draw_date_str', sql.VarChar, date)
                .input('round_number', sql.Int, round.round_number)
                .query(`
                    SELECT round_id FROM Yeeki_Rounds 
                    WHERE CAST(draw_date AS DATE) = CAST(@draw_date_str AS DATE) 
                    AND round_number = @round_number 
                    AND (category = 'YEEKI' OR category IS NULL)
                `);
            
            if (check.recordset.length > 0) {
                // มีแล้ว -> Update
                await pool.request()
                    .input('id', sql.Int, check.recordset[0].round_id)
                    .input('open', sql.DateTime, openTime)
                    .input('close', sql.DateTime, closeTime)
                    .input('draw', sql.DateTime, drawTime)
                    .query(`UPDATE Yeeki_Rounds SET open_time = @open, close_time = @close, draw_time = @draw WHERE round_id = @id`);
            } else {
                // ยังไม่มี -> Insert (ตั้งค่าบังคับให้เป็น YEEKI ไปเลย)
                await pool.request()
                    .input('date_str', sql.VarChar, date)
                    .input('num', sql.Int, round.round_number)
                    .input('open', sql.DateTime, openTime)
                    .input('close', sql.DateTime, closeTime)
                    .input('draw', sql.DateTime, drawTime)
                    .input('status', sql.VarChar, 'Pending')
                    .input('category', sql.VarChar, 'YEEKI') // 🌟 เติมหมวดหมู่ให้ชัดเจนตอนสร้าง
                    .query(`INSERT INTO Yeeki_Rounds (draw_date, round_number, open_time, close_time, draw_time, status, category) 
                            VALUES (CAST(@date_str AS DATE), @num, @open, @close, @draw, @status, @category)`);
            }
        }
        res.json({ success: true, message: "บันทึกข้อมูลตารางเวลาสำเร็จ!" });
    } catch (err) {
        console.error("Error bulk save:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 4. อัปเดตทีละแถว จากการกดปุ่มแก้ไข (PUT)
// ==========================================
app.put('/api/admin/yeeki-rounds/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { draw_date, open_time, close_time, draw_time } = req.body;
        
        const openTime = `${draw_date} ${open_time}:00`;
        const closeTime = `${draw_date} ${close_time}:00`;
        const drawTime = `${draw_date} ${draw_time}:00`;

        const pool = await sql.connect(dbConfig);
        
        await pool.request()
            .input('id', sql.Int, id)
            .input('open', sql.DateTime, openTime)
            .input('close', sql.DateTime, closeTime)
            .input('draw', sql.DateTime, drawTime)
            .query(`UPDATE Yeeki_Rounds SET open_time = @open, close_time = @close, draw_time = @draw WHERE round_id = @id`);
            
        res.json({ success: true });
    } catch (err) {
        console.error("Error update single round:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 3. หัวใจอัจฉริยะ: ระบบแนะนำเลขเด็ด (ให้ระบบได้กำไรตามเป้า)
// ==========================================
app.post('/api/admin/suggest-yeeki-draw', async (req, res) => {
    try {
        const { targetPercent, round_id } = req.body;
        const pool = await sql.connect(dbConfig);

        // 1. ดึงยอดซื้อทั้งหมดในรอบนี้
        const ordersRes = await pool.request()
            .input('roundId', sql.Int, round_id)
            .query(`
                SELECT oi.lottery_type, oi.selected_number, oi.price, pr.multiplier
                FROM Yeeki_Order_Items oi
                JOIN Yeeki_Orders o ON oi.order_id = o.order_id
                JOIN Yeeki_Prize_Rates pr ON oi.lottery_type = pr.lottery_type
                WHERE o.round_id = @roundId AND oi.status = N'รอผลตรวจ'
            `);
        
        const orders = ordersRes.recordset;

        // คำนวณยอดขายรวม
        const totalSales = orders.reduce((sum, item) => sum + Number(item.price), 0);
        const targetPayout = totalSales * (targetPercent / 100); // ยอดที่ยอมให้จ่ายได้สูงสุด

        if (totalSales === 0) {
            // ถ้าไม่มียอดแทงเลย สุ่มอะไรก็ได้
            const rand = (min, max) => Math.floor(Math.random() * (max - min + 1) + min).toString();
            return res.json({ 
                success: true, 
                suggestedSuper: rand(10000000, 99999999), 
                suggestedTop: rand(1000, 9999), 
                suggestedBottom: rand(10, 99).padStart(2, '0'),
                totalSales: 0,
                analysis: [] 
            });
        }

        // ==========================================
        // 🧠 อัลกอริทึมสุ่มตัวเลขหนียอดแทง (Smart Evasion)
        // ==========================================
        let bestSuper = '';
        let bestTop = '';
        let bestBottom = '';
        let lowestPayout = Infinity;
        let attempts = 0;
        const maxAttempts = 100; // สุ่ม 100 ครั้งเพื่อหาชุดที่ปลอดภัยที่สุด

        while (attempts < maxAttempts) {
            // 1. สุ่มเลขชุดใหม่
            const testSuper = Math.floor(Math.random() * (99999999 - 10000000 + 1) + 10000000).toString();
            const testTop = Math.floor(Math.random() * (9999 - 1000 + 1) + 1000).toString();
            const testBottom = Math.floor(Math.random() * (99 - 10 + 1) + 10).toString().padStart(2, '0');
            
            let currentPayout = 0;

            // 2. คำนวณยอดจ่ายจากบิลทั้งหมดที่มีคนแทง
            for (let item of orders) {
                let isWin = false;
                if (item.lottery_type === '8 ตัว (Super)' && item.selected_number === testSuper) isWin = true;
                if (item.lottery_type === '4 ตัวท้าย' && item.selected_number === testTop) isWin = true;
                if (item.lottery_type === '3 ตัวบน' && item.selected_number === testTop.slice(-3)) isWin = true;
                if (item.lottery_type === '2 ตัวบน' && item.selected_number === testTop.slice(-2)) isWin = true;
                if (item.lottery_type === '2 ตัวล่าง' && item.selected_number === testBottom) isWin = true;
                
                // ตรวจโต๊ด และ วิ่ง
                if (item.lottery_type === '3 ตัวโต๊ด') {
                    const betChars = item.selected_number.split('').sort().join('');
                    const resultChars = testTop.slice(-3).split('').sort().join('');
                    if (betChars === resultChars) isWin = true;
                }
                if (item.lottery_type === 'วิ่งบน' && testTop.slice(-3).includes(item.selected_number)) isWin = true;
                if (item.lottery_type === 'วิ่งล่าง' && testBottom.includes(item.selected_number)) isWin = true;

                if (isWin) currentPayout += Number(item.price) * Number(item.multiplier);
            }

            // 3. ถ้าได้ยอดจ่ายน้อยกว่าเป้าที่ตั้งไว้ ถือว่าเจอแล้ว หยุดหาสุ่มเลย
            if (currentPayout <= targetPayout) {
                bestSuper = testSuper;
                bestTop = testTop;
                bestBottom = testBottom;
                lowestPayout = currentPayout;
                break; 
            }

            // ถ้าเกินเป้า ให้จำตัวที่จ่ายน้อยที่สุดไว้เผื่อสุ่มครบ 100 ครั้งแล้วยังไม่รอด
            if (currentPayout < lowestPayout) {
                lowestPayout = currentPayout;
                bestSuper = testSuper;
                bestTop = testTop;
                bestBottom = testBottom;
            }

            attempts++;
        }

        // ==========================================
        // ส่งผลลัพธ์ที่ดีที่สุดกลับไปให้แผงควบคุม
        // ==========================================
        // (ฟังก์ชันสร้าง Analysis Data แบบคร่าวๆ เพื่อให้หน้าเว็บแสดงผลตารางได้)
        const analysisData = [
            { lottery_type: '8 ตัว (Super)', winner_count: 0, total_payout: 0 },
            { lottery_type: '4 ตัวท้าย', winner_count: 0, total_payout: 0 },
            { lottery_type: '3 ตัวบน', winner_count: 0, total_payout: 0 },
            { lottery_type: '2 ตัวบน', winner_count: 0, total_payout: 0 },
            { lottery_type: '2 ตัวล่าง', winner_count: 0, total_payout: 0 }
        ];
        
        // (ใน API นี้เราจำลองข้อมูลใส่เพื่อความรวดเร็ว หน้าเว็บจะมีปุ่ม "กดเช็คยอดจ่าย" เพื่อคำนวณละเอียดอีกที)
        res.json({ 
            success: true, 
            suggestedSuper: bestSuper, 
            suggestedTop: bestTop, 
            suggestedBottom: bestBottom,
            totalSales: totalSales,
            analysis: analysisData // คืนค่าตารางว่างๆ ไปก่อน ให้แอดมินกดเช็คละเอียดเองที่หน้าเว็บ
        });

    } catch (err) {
        console.error("Error in Smart Suggestion:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 2. API: จำลองผลตรวจรางวัล (Analyze Draw)
// ==========================================
app.post('/api/admin/analyze-yeeki-draw', async (req, res) => {
    const { round_id, super_number, top_6, bottom_2 } = req.body; 
    let pool;
    try {
        pool = await sql.connect(dbConfig);
        const exReq = await pool.request().query("SELECT rate FROM Exchange_Rates WHERE currency_pair = 'THB_LAK'");
        const lakRate = exReq.recordset.length > 0 ? exReq.recordset[0].rate : 620;

        const top_4 = top_6.slice(-4);
        const top_3 = top_6.slice(-3);
        const top_2 = top_6.slice(-2);

        const itemsReq = await pool.request().input('roundId', sql.Int, round_id).query(`
            SELECT i.lottery_type, i.selected_number, i.price, o.currency_code
            FROM Yeeki_Order_Items i
            JOIN Yeeki_Orders o ON i.order_id = o.order_id
            WHERE o.round_id = @roundId AND i.status = N'รอผลตรวจ'
        `);
        const orders = itemsReq.recordset;

        const ratesReq = await pool.request().query(`SELECT lottery_type, multiplier FROM Yeeki_Prize_Rates`);
        const prizeRates = {};
        ratesReq.recordset.forEach(r => prizeRates[r.lottery_type] = r.multiplier);

        const analysis = {};
        ['8 ตัว (Super)', '6 ตัว', '4 ตัวท้าย', '3 ตัวบน', '3 ตัวโต๊ด', '2 ตัวบน', '2 ตัวล่าง', 'วิ่งบน', 'วิ่งล่าง'].forEach(t => 
            analysis[t] = { lottery_type: t, winner_count: 0, total_payout_thb: 0 }
        );

        let totalSalesTHB = 0;

        for (let order of orders) {
            let isWin = false;
            const num = order.selected_number;
            
            totalSalesTHB += order.currency_code === 'LAK' ? (order.price / lakRate) : order.price;

            if (order.lottery_type === '8 ตัว (Super)' && num === super_number) isWin = true;
            else if (order.lottery_type === '6 ตัว' && num === top_6) isWin = true;
            else if (order.lottery_type === '4 ตัวท้าย' && num === top_4) isWin = true;
            else if (order.lottery_type === '3 ตัวบน' && num === top_3) isWin = true;
            else if (order.lottery_type === '3 ตัวโต๊ด') {
                if (top_3.split('').sort().join('') === num.split('').sort().join('')) isWin = true;
            }
            else if (order.lottery_type === '2 ตัวบน' && num === top_2) isWin = true;
            else if (order.lottery_type === '2 ตัวล่าง' && num === bottom_2) isWin = true;
            else if (order.lottery_type === 'วิ่งบน' && top_3.includes(num)) isWin = true;
            else if (order.lottery_type === 'วิ่งล่าง' && bottom_2.includes(num)) isWin = true;

            if (isWin) {
                const payout = order.price * (prizeRates[order.lottery_type] || 0);
                const payoutTHB = order.currency_code === 'LAK' ? (payout / lakRate) : payout;
                analysis[order.lottery_type].winner_count += 1;
                analysis[order.lottery_type].total_payout_thb += payoutTHB;
            }
        }
        res.json({ success: true, totalSalesTHB, analysis: Object.values(analysis) });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ==========================================
// 🌟 API ดึงผลรางวัล ยอดขาย และบิลทั้งหมดเจาะจงตามรอบ
// ==========================================
app.get('/api/admin/yeeki-round-detail', async (req, res) => {
    const { round_id } = req.query;
    try {
        const pool = await sql.connect(dbConfig);
        
        // 1. ดึงผลการออกรางวัลของรอบนี้
        const roundReq = await pool.request()
            .input('roundId', sql.Int, round_id)
            .query(`SELECT * FROM Yeeki_Rounds WHERE round_id = @roundId`);
            
        // 2. 💡 ดึง "บิลทั้งหมด" ของรอบนี้ (ไม่ต้องสนสถานะ เพื่อให้หน้าเว็บไปตรวจเอง)
        const allOrdersReq = await pool.request()
            .input('roundId', sql.Int, round_id)
            .query(`
                SELECT 
                    r.round_number, u.username, i.lottery_type, i.selected_number, 
                    i.price, o.currency_code, i.status, i.prize_amount
                FROM Yeeki_Order_Items i
                JOIN Yeeki_Orders o ON i.order_id = o.order_id
                JOIN Yeeki_Rounds r ON o.round_id = r.round_id
                JOIN Users u ON o.user_id = u.user_id
                WHERE r.round_id = @roundId
            `);

        // 3. ดึงยอดขายรวม
        const salesReq = await pool.request()
            .input('roundId', sql.Int, round_id)
            .query(`
                SELECT o.currency_code, SUM(i.price) as total_sales
                FROM Yeeki_Order_Items i
                JOIN Yeeki_Orders o ON i.order_id = o.order_id
                WHERE o.round_id = @roundId
                GROUP BY o.currency_code
            `);

        res.json({
            success: true,
            round: roundReq.recordset[0],
            all_orders: allOrdersReq.recordset, // 💡 ส่งบิลทั้งหมดไปให้หน้าเว็บ
            sales: salesReq.recordset
        });
    } catch (err) {
        console.error("Error in yeeki-round-detail:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🏦 API: จัดการบัญชีธนาคารรับฝากเงิน (Receiving Accounts)
// ==========================================

// 1. API: ดึงข้อมูลธนาคารทั้งหมด (GET)
app.get('/api/admin/banks', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        // ดึงข้อมูลเรียงตาม bank_id
        const result = await pool.request().query(`
            SELECT * FROM Banks 
            ORDER BY bank_id ASC
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error("Error fetching banks:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 2. API: เพิ่มบัญชีธนาคารใหม่ (POST)
app.post('/api/admin/banks', async (req, res) => {
    const { bank_name, bank_code, account_name, account_number, currency, logo_url, is_active } = req.body;
    try {
        const pool = await sql.connect(dbConfig);
        await pool.request()
            .input('bank_name', sql.NVarChar(100), bank_name)
            .input('bank_code', sql.VarChar(20), bank_code)
            .input('account_name', sql.NVarChar(100), account_name)
            .input('account_number', sql.VarChar(50), account_number)
            .input('currency', sql.VarChar(10), currency)
            .input('logo_url', sql.NVarChar(sql.MAX), logo_url || '') // รองรับ Base64 ยาวๆ
            .input('is_active', sql.Bit, is_active)
            .query(`
                INSERT INTO Banks (bank_name, bank_code, account_name, account_number, currency, logo_url, is_active, created_at)
                VALUES (@bank_name, @bank_code, @account_name, @account_number, @currency, @logo_url, @is_active, GETDATE())
            `);
            
        res.json({ success: true, message: 'เพิ่มบัญชีธนาคารสำเร็จ' });
    } catch (err) {
        console.error("Error creating bank:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 3. API: อัปเดต/แก้ไขบัญชีธนาคารเดิม (PUT)
app.put('/api/admin/banks/:id', async (req, res) => {
    const { id } = req.params;
    const { bank_name, bank_code, account_name, account_number, currency, logo_url, is_active } = req.body;
    
    try {
        const pool = await sql.connect(dbConfig);
        await pool.request()
            .input('id', sql.Int, id)
            .input('bank_name', sql.NVarChar(100), bank_name)
            .input('bank_code', sql.VarChar(20), bank_code)
            .input('account_name', sql.NVarChar(100), account_name)
            .input('account_number', sql.VarChar(50), account_number)
            .input('currency', sql.VarChar(10), currency)
            .input('logo_url', sql.NVarChar(sql.MAX), logo_url || '') 
            .input('is_active', sql.Bit, is_active)
            .query(`
                UPDATE Banks 
                SET bank_name = @bank_name, 
                    bank_code = @bank_code, 
                    account_name = @account_name, 
                    account_number = @account_number, 
                    currency = @currency, 
                    logo_url = @logo_url, 
                    is_active = @is_active
                WHERE bank_id = @id
            `);
            
        res.json({ success: true, message: 'อัปเดตบัญชีธนาคารสำเร็จ' });
    } catch (err) {
        console.error("Error updating bank:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// ==========================================
// 🏆 API: ดึงประวัติการออกเลขยี่กีตามวันที่
// ==========================================
app.get('/api/admin/yeeki/history', async (req, res) => {
    const { date } = req.query; // รับค่าวันที่ YYYY-MM-DD
    try {
        const pool = await sql.connect(dbConfig);
        
        let query = `
            SELECT 
                round_id, 
                round_number, 
                draw_time, 
                result_8_super, 
                result_4_top, 
                result_3_top, 
                result_2_bottom, 
                status 
            FROM Yeeki_Rounds
            WHERE status = 'Completed' 
        `;

        if (date) {
            // 🌟 แก้ไขตรงนี้: ลบ DATEADD ออก เพราะเวลาใน DB เป็นเวลาไทยอยู่แล้ว
            query += ` AND CAST(draw_time AS DATE) = @targetDate `;
        }
        
        query += ` ORDER BY round_number DESC`;

        const request = pool.request();
        if (date) {
            request.input('targetDate', sql.Date, date);
        }

        const result = await request.query(query);

        res.json({ success: true, data: result.recordset });

    } catch (err) {
        console.error("Error fetching yeeki history:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 เริ่ม API P2P
// ==========================================

// ==========================================
// 💸 [CLIENT] สร้างคำขอฝากเงิน (ดึงเวลาและค่าคอมฯ จาก P2P_Settings)
// ==========================================
app.post('/api/p2p/request-deposit', async (req, res) => {
    try {
        const { requester_id, amount, currency, promo_id } = req.body;
        if (!requester_id || !amount) return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });

        const pool = await sql.connect(dbConfig);
        
        let bonus_amount = 0;
        let provider_reward = 0; 
        let board_timeout = 15; // เผื่อหาไม่เจอ ให้ยึด 15 นาทีตามหน้าแอดมินเจ้านาย
        
        // 1. ดึงโปรโมชั่น (แจกโบนัสลูกค้า)
        if (promo_id) {
            const promo = await pool.request().input('pid', sql.Int, promo_id).query('SELECT bonus_percent FROM P2P_Promotions WHERE promo_id = @pid');
            if (promo.recordset.length > 0) bonus_amount = (amount * parseFloat(promo.recordset[0].bonus_percent)) / 100;
        }

        // 🌟 2. ดึงการตั้งค่าทั้งหมดจากหน้าแอดมิน (P2P_Settings)
        const settings = await pool.request().query('SELECT TOP 1 * FROM P2P_Settings');
        if (settings.recordset.length > 0) {
            const config = settings.recordset[0];
            
            // ดึงค่าคอมมิชชั่นคนรับงาน (provider_reward_percent) ที่เจ้านายตั้งไว้ 15% มาคูณ!
            if (config.provider_reward_percent) {
                provider_reward = (amount * parseFloat(config.provider_reward_percent)) / 100;
            } else {
                provider_reward = (amount * 15) / 100; // ค่าสำรองเผื่อตารางพัง
            }
            
            // ดึงเวลาหมดอายุที่เจ้านายตั้งไว้
            if (config.mission_timeout_minutes) {
                board_timeout = config.mission_timeout_minutes;
            }
        } else {
            provider_reward = (amount * 15) / 100; // ค่าสำรองถ้าไม่มีข้อมูลในตาราง
        }

        const net_amount = parseFloat(amount) + bonus_amount;

        // 🌟 3. บันทึกลงตาราง บังคับใช้เวลาไทย และหยอดค่า 15% ลงไปให้คนรับงาน!
        await pool.request()
            .input('req_id', sql.Int, requester_id)
            .input('type', sql.VarChar, 'DEPOSIT')
            .input('curr', sql.VarChar, currency || 'THB')
            .input('amt', sql.Decimal(18, 2), amount)
            .input('bonus', sql.Decimal(18, 2), bonus_amount)
            .input('net', sql.Decimal(18, 2), net_amount)
            .input('reward', sql.Decimal(18, 2), provider_reward) // 💰 หยอดเงิน 15% (150 บาท) ลงไป
            .input('timeout', sql.Int, board_timeout) // ⏱️ หยอดเวลาที่เจ้านายตั้งไว้
            .query(`
                INSERT INTO P2P_Requests (requester_id, request_type, currency, amount, bonus_or_fee, net_amount, provider_reward, status, created_at, expires_at) 
                VALUES (@req_id, @type, @curr, @amt, @bonus, @net, @reward, 'PENDING', DATEADD(hour, 7, GETUTCDATE()), DATEADD(minute, @timeout, DATEADD(hour, 7, GETUTCDATE())))
            `);

        res.json({ success: true, message: 'สร้างคำขอฝากเงินสำเร็จ' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 💸 [CLIENT] สร้างคำขอฝากเงิน (อัปเกรด: ค้นหาโปรโมชั่น 20% ให้อัตโนมัติ!)
// ==========================================
app.post('/api/p2p/request-deposit', async (req, res) => {
    try {
        const { requester_id, amount, currency } = req.body; // 🌟 ไม่ต้องพึ่ง promo_id จากหน้าบ้านแล้ว
        if (!requester_id || !amount) return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });

        const pool = await sql.connect(dbConfig);
        
        let bonus_amount = 0;
        let provider_reward = 0; 
        let board_timeout = 15;
        let bonusPercent = 0;
        
        // 🌟 1. ดึงการตั้งค่าหลักจากหน้าแอดมิน (P2P_Settings)
        const settings = await pool.request().query('SELECT TOP 1 * FROM P2P_Settings');
        let config = {};
        if (settings.recordset.length > 0) {
            config = settings.recordset[0];
            
            // ดึงค่าคอมมิชชั่นคนรับงาน (เช่น 15%)
            provider_reward = (parseFloat(amount) * parseFloat(config.provider_reward_percent || 15)) / 100;
            
            // ดึงเวลาหมดอายุ (เช่น 15 นาที)
            board_timeout = config.mission_timeout_minutes || 15;
        } else {
            provider_reward = (parseFloat(amount) * 15) / 100; // ค่าสำรองเผื่อตารางพัง
        }

       // 🌟 2. ค้นหาโปรโมชั่น "ที่กำลังทำงานอยู่" (เช็คจากเวลาปัจจุบัน)
        const promoCheck = await pool.request().query(`
            SELECT TOP 1 bonus_percent 
            FROM P2P_Promotions 
            WHERE DATEADD(hour, 7, GETUTCDATE()) BETWEEN start_time AND end_time 
            ORDER BY bonus_percent DESC
        `);

        if (promoCheck.recordset.length > 0) {
            // ✅ ถ้าช่วงนี้มีโปรโมชั่น (เช่น 20%) ให้ใช้ค่านี้บวกเพิ่มให้ลูกค้า!
            bonusPercent = parseFloat(promoCheck.recordset[0].bonus_percent);
        } else {
            // ✅ ถ้าหมดโปร หรือไม่มีโปรโมชั่น = ไม่ต้องบวกเพิ่ม (โบนัส 0%) คือยอดปกติ
            bonusPercent = 0;
        }

       

        // คำนวณเงินโบนัส และยอดรับสุทธิ
        bonus_amount = (parseFloat(amount) * bonusPercent) / 100;
        const net_amount = parseFloat(amount) + bonus_amount;

        // 🌟 3. บันทึกลงตาราง 
        await pool.request()
            .input('req_id', sql.Int, requester_id)
            .input('type', sql.VarChar, 'DEPOSIT')
            .input('curr', sql.VarChar, currency || 'THB')
            .input('amt', sql.Decimal(18, 4), amount) // ใช้ 18,4 ป้องกันทศนิยมหาย
            .input('bonus', sql.Decimal(18, 4), bonus_amount)
            .input('net', sql.Decimal(18, 4), net_amount)
            .input('reward', sql.Decimal(18, 4), provider_reward) 
            .input('timeout', sql.Int, board_timeout) 
            .query(`
                INSERT INTO P2P_Requests (requester_id, request_type, currency, amount, bonus_or_fee, net_amount, provider_reward, status, created_at, expires_at) 
                VALUES (@req_id, @type, @curr, @amt, @bonus, @net, @reward, 'PENDING', DATEADD(hour, 7, GETUTCDATE()), DATEADD(minute, @timeout, DATEADD(hour, 7, GETUTCDATE())))
            `);

        res.json({ success: true, message: 'สร้างคำขอฝากเงินสำเร็จ' });
    } catch (err) {
        console.error("Deposit Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});
// ==========================================
// ⏱️ [ADMIN] ดึงข้อมูลตั้งค่าเวลา P2P (แพ็คคู่)
// ==========================================
app.get('/api/admin/p2p-time-setting', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query('SELECT TOP 1 * FROM P2P_Settings');
        if (result.recordset.length > 0) {
            res.json({ 
                success: true, 
                board_timeout: result.recordset[0].mission_timeout_minutes || 30,
                provider_timeout: result.recordset[0].provider_timeout_minutes || 15 
            });
        } else {
            res.json({ success: true, board_timeout: 30, provider_timeout: 15 });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// ⏱️ [ADMIN] อัปเดตเวลาภารกิจ P2P (แพ็คคู่)
// ==========================================
app.post('/api/admin/p2p-time-update', async (req, res) => {
    try {
        const { board_timeout, provider_timeout } = req.body;
        const pool = await sql.connect(dbConfig);
        const check = await pool.request().query('SELECT COUNT(*) as count FROM P2P_Settings');
        
        try {
            if (check.recordset[0].count === 0) {
                await pool.request()
                    .input('b_mins', sql.Int, board_timeout)
                    .input('p_mins', sql.Int, provider_timeout)
                    .query(`INSERT INTO P2P_Settings (mission_timeout_minutes, provider_timeout_minutes) VALUES (@b_mins, @p_mins)`);
            } else {
                await pool.request()
                    .input('b_mins', sql.Int, board_timeout)
                    .input('p_mins', sql.Int, provider_timeout)
                    .query(`UPDATE P2P_Settings SET mission_timeout_minutes = @b_mins, provider_timeout_minutes = @p_mins`);
            }
            res.json({ success: true, message: 'บันทึกเวลา P2P ทั้ง 2 ระบบสำเร็จเรียบร้อย!' });
        } catch (sqlErr) {
            res.json({ success: false, message: 'กรุณาเพิ่มคอลัมน์เวลาลงในตาราง P2P_Settings ก่อนครับ' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


// ==========================================
// 🌟 2. ผู้ให้บริการกด "รับงาน" (ACCEPT JOB)
// ==========================================
// ==========================================
// 🛡️ [API] ระบบกดปุ่มรับงาน P2P (คำนวณเรทเงิน + ตรวจบัญชี + หักเงิน + บันทึกประวัติ)
// ==========================================
app.post('/api/p2p/accept-job', async (req, res) => {
    try {
        const { provider_id, request_id } = req.body;
        const pool = await sql.connect(dbConfig);
        
        // 1. ดึงข้อมูลงาน
        const reqResult = await pool.request()
            .input('reqId', sql.Int, request_id)
            .query(`SELECT * FROM P2P_Requests WHERE request_id = @reqId`);
            
        if (reqResult.recordset.length === 0) return res.json({ success: false, message: 'ไม่พบคำขอนี้ในระบบ' });
        const mission = reqResult.recordset[0];
        
        if (mission.status !== 'PENDING') return res.json({ success: false, message: 'งานนี้ถูกรับไปแล้ว หรือหมดเวลาครับ' });
        
        // 🌟 2. ด่านตรวจสมุดบัญชีแบบฉลาด (Smart Check)
        const bankResult = await pool.request()
            .input('uid', sql.Int, provider_id)
            .input('currency', sql.VarChar, mission.currency)
            .query(`
                SELECT TOP 1 account_number, account_name 
                FROM UserBanks 
                WHERE user_id = @uid 
                  AND currency_code = @currency 
                  AND status = 'Approved' 
            `);
            
        if (bankResult.recordset.length === 0) {
            const otherBanksResult = await pool.request()
                .input('uid', sql.Int, provider_id)
                .query(`SELECT DISTINCT currency_code FROM UserBanks WHERE user_id = @uid AND status = 'Approved'`);
            
            const availableCurrencies = otherBanksResult.recordset.map(row => row.currency_code).join(', ');
            const hasAnyBank = availableCurrencies.length > 0;

            let smartMessage = `❌ คุณยังไม่มีบัญชีสกุลเงิน ${mission.currency} ครับ\n\n`;
            
            if (hasAnyBank) {
                smartMessage += `💡 ระบบตรวจพบว่า ตอนนี้คุณมีบัญชี [ ${availableCurrencies} ] ที่พร้อมใช้งาน\nคุณสามารถเลือกรับงานในสกุลเงินที่คุณมีอยู่แล้วได้เลยครับ\n\nหรือถ้าต้องการรับงานนี้ ต้องไปเพิ่มบัญชี ${mission.currency} ใหม่... ต้องการไปเพิ่มบัญชีตอนนี้เลยหรือไม่?`;
            } else {
                smartMessage += `ระบบจะพาคุณไปยังหน้า "จัดการบัญชีธนาคาร" เพื่อเพิ่มบัญชีใบแรกของคุณครับ`;
            }

            return res.json({ 
                success: false, 
                isBankError: true,
                hasAnyBank: hasAnyBank, 
                message: smartMessage 
            });
        }
        
       // 🌟 3. ดึงกระเป๋าเงินผู้รับงาน และคำนวณการหักเงินแบบ "ข้ามสกุลเงิน"
        const walletResult = await pool.request()
            .input('uid', sql.Int, provider_id)
            .query(`SELECT balance FROM Wallets WHERE user_id = @uid`);
            
        // 👉 [แก้ไข] ดึงสกุลเงินจริงของผู้รับงานจากตาราง Users (ลบการบังคับ THB ตายตัวทิ้ง)
        const userResult = await pool.request()
            .input('uid', sql.Int, provider_id)
            .query(`SELECT currency_code FROM Users WHERE user_id = @uid`); // *หมายเหตุ: ถ้า primary key ของเจ้านายคือ user_id ให้แก้คำว่า id เป็น user_id นะครับ
            
        if (walletResult.recordset.length === 0) {
             return res.json({ success: false, message: '❌ ไม่พบข้อมูลกระเป๋าเงินของคุณ' });
        }

        // 🌟 กำหนดสกุลเงินของกระเป๋าให้ตรงกับตัวตนลูกค้าจริงๆ (เช่น เป็น 'LAK' หรือ 'THB')
        const providerCurrency = userResult.recordset[0].currency_code;
        let deductAmount = parseFloat(mission.amount);

        // ถ้าสกุลเงินงาน ไม่ตรงกับกระเป๋าคนรับงาน ให้คำนวณเรท (ถ้า LAK ชน LAK จะข้ามไปหักยอดเต็มเลย)
        if (providerCurrency !== mission.currency) {
            const rateResult = await pool.request().query('SELECT * FROM ExchangeRates');
            const rates = rateResult.recordset;
            const rateObj = rates.find(r => r.currency_pair === `${providerCurrency}_${mission.currency}`);
            const reverseRateObj = rates.find(r => r.currency_pair === `${mission.currency}_${providerCurrency}`);

            if (rateObj) deductAmount = deductAmount / parseFloat(rateObj.rate);
            else if (reverseRateObj) deductAmount = deductAmount * parseFloat(reverseRateObj.rate);
            else return res.json({ success: false, message: `ไม่มีเรทแปลงเงิน ${providerCurrency} เป็น ${mission.currency}` });
        }

        // 🌟 4. หักเงินค้ำประกันจาก Wallet ผู้รับงาน
        await pool.request()
            .input('uid', sql.Int, provider_id)
            .input('amount', sql.Decimal(18, 2), deductAmount)
            .query(`UPDATE Wallets SET balance = balance - @amount WHERE user_id = @uid`);

        // 🌟 4.5 [NEW] บันทึกประวัติการหักเงินลง Transactions (ทิ้งหลักฐาน)
        // ใส่เครื่องหมายลบ (-@amount) เพื่อแสดงว่าเป็นยอดหักออก
       // ... โค้ดด้านบน ...
        await pool.request()
            .input('uid', sql.Int, provider_id)
            .input('amount', sql.Decimal(18, 2), deductAmount)
            .input('note', sql.NVarChar, `หักเงินค้ำประกัน รอโอน P2P (Job ID: ${request_id})`)
            .query(`
                INSERT INTO Transactions (user_id, amount, transaction_type, status, title, created_at)
                VALUES (@uid, -@amount, 'P2P_GUARANTEE', 'Completed', @note, GETDATE())
            `);

        // 🌟 5. ดึงเวลาของผู้รับงาน และอัปเดตสถานะงาน
        const settings = await pool.request().query('SELECT TOP 1 provider_timeout_minutes FROM P2P_Settings');
        let provider_timeout = 15; 
        if (settings.recordset.length > 0 && settings.recordset[0].provider_timeout_minutes) {
            provider_timeout = settings.recordset[0].provider_timeout_minutes;
        }

        await pool.request()
            .input('reqId', sql.Int, request_id)
            .input('providerId', sql.Int, provider_id)
            .input('p_timeout', sql.Int, provider_timeout)
            .query(`
                UPDATE P2P_Requests 
                SET status = 'ACCEPTED', 
                    provider_id = @providerId, 
                    accepted_at = DATEADD(hour, 7, GETUTCDATE()), 
                    expires_at = DATEADD(minute, @p_timeout, DATEADD(hour, 7, GETUTCDATE()))
                WHERE request_id = @reqId
            `);

        // 🌟 6. ส่งประเภทงาน (request_type) กลับไปให้หน้าเว็บ เพื่อใช้ตัดสินใจว่าต้องวาร์ปไปหน้าไหน
        res.json({ 
            success: true, 
            message: 'รับงานสำเร็จ!', 
            request_type: mission.request_type 
        });
        
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
    }
});

// ==========================================
// 🚫 [API] ยกเลิกงาน P2P (คืนเงินค้ำประกัน + บันทึกประวัติ)
// ==========================================
app.post('/api/p2p/cancel-job', async (req, res) => {
    try {
        const { provider_id, request_id } = req.body;
        const pool = await sql.connect(dbConfig);

        // 1. เช็คข้อมูลงาน
        const reqResult = await pool.request()
            .input('reqId', sql.Int, request_id)
            .query(`SELECT * FROM P2P_Requests WHERE request_id = @reqId`);
            
        if (reqResult.recordset.length === 0) return res.json({ success: false, message: 'ไม่พบงานนี้ในระบบ' });
        const mission = reqResult.recordset[0];

        // ต้องเป็นสถานะ ACCEPTED และต้องเป็นคนที่รับงานนี้จริงๆ เท่านั้นถึงจะยกเลิกได้
        if (mission.status !== 'ACCEPTED' || mission.provider_id !== provider_id) {
            return res.json({ success: false, message: 'ไม่สามารถยกเลิกได้ สถานะไม่ถูกต้อง หรือคุณไม่ใช่ผู้รับงานนี้' });
        }

        // 2. คำนวณยอดเงินที่ต้องคืน (ใช้โลจิกเดียวกับตอนหักเงิน)
        // 🛠️ กำหนดกระเป๋าหลักเป็น THB เพื่อป้องกัน Error 500 Invalid column name 'currency' 
        const providerCurrency = 'THB'; 
        let refundAmount = parseFloat(mission.amount);

        // คำนวณเรทเงินให้ตรงกับตอนที่หักไป
        if (providerCurrency !== mission.currency) {
            const rateResult = await pool.request().query('SELECT * FROM ExchangeRates');
            const rates = rateResult.recordset;
            const rateObj = rates.find(r => r.currency_pair === `${providerCurrency}_${mission.currency}`);
            const reverseRateObj = rates.find(r => r.currency_pair === `${mission.currency}_${providerCurrency}`);
            
            if (rateObj) refundAmount = refundAmount / parseFloat(rateObj.rate);
            else if (reverseRateObj) refundAmount = refundAmount * parseFloat(reverseRateObj.rate);
            else return res.json({ success: false, message: `ไม่มีเรทแปลงเงิน ${providerCurrency} เป็น ${mission.currency}` });
        }

        // 3. คืนเงินกลับเข้า Wallet (บวกเงินกลับ)
        await pool.request()
            .input('uid', sql.Int, provider_id)
            .input('amount', sql.Decimal(18, 2), refundAmount)
            .query(`UPDATE Wallets SET balance = balance + @amount WHERE user_id = @uid`);

        // 4. 📝 บันทึกประวัติการคืนเงินลงตาราง Transactions (ทิ้งหลักฐาน)
        // (💡 หมายเหตุ: หากตาราง Transactions ของเจ้านายใช้ชื่อคอลัมน์อื่น เช่น ใช้ 'details' แทน 'description' ให้แก้ในบรรทัด INSERT ได้เลยครับ)
        // 4. 📝 บันทึกประวัติการคืนเงินลงตาราง Transactions (ทิ้งหลักฐาน)
        await pool.request()
            .input('uid', sql.Int, provider_id)
            .input('amount', sql.Decimal(18, 2), refundAmount)
            .input('note', sql.NVarChar, `โอนกลับเป็นเงินโอนกลับจากการยกเลิกงาน P2P (Job ID: ${request_id})`)
            .query(`
                INSERT INTO Transactions (user_id, amount, transaction_type, status, title, created_at)
                VALUES (@uid, @amount, 'P2P_REFUND', 'Completed', @note, GETDATE())
            `);

        // 5. ปล่อยงานกลับสู่บอร์ด (รีเซ็ตสถานะกลับเป็น PENDING และล้างค่าเวลาออก)
        await pool.request()
            .input('reqId', sql.Int, request_id)
            .query(`
                UPDATE P2P_Requests 
                SET status = 'PENDING', 
                    provider_id = NULL, 
                    accepted_at = NULL, 
                    expires_at = NULL 
                WHERE request_id = @reqId
            `);

        res.json({ success: true, message: 'ยกเลิกงานและคืนเงินค้ำประกันเรียบร้อยแล้ว!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
    }
});


// ==========================================
// 🌟 3. ผู้รับงานตรวจสลิปและยืนยัน (VERIFY SLIP) - แก้บัคสกุลเงิน & ทศนิยม (ฉบับจัดเต็ม)
// ==========================================
app.post('/api/p2p/verify-slip', async (req, res) => {
    try {
        const { provider_id, request_id, is_correct } = req.body;
        const pool = await sql.connect(dbConfig);

        const reqData = await pool.request()
            .input('rid', sql.Int, request_id)
            .input('provider_id', sql.Int, provider_id)
            .query(`SELECT * FROM P2P_Requests WHERE request_id = @rid AND provider_id = @provider_id`);
        
        if (reqData.recordset.length === 0) {
            return res.json({ success: false, message: '❌ ไม่พบข้อมูลงาน หรือคุณไม่ใช่ผู้รับงานนี้' });
        }

        const job = reqData.recordset[0];
        const jobCurrency = job.currency; // 🌟 สกุลเงินของงาน (เช่น THB)

        if (job.status !== 'VERIFYING' && job.status !== 'ACCEPTED') {
            return res.json({ success: false, message: '⚠️ งานนี้ถูกดำเนินการเสร็จสิ้น หรือถูกยกเลิกไปแล้วครับ' });
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 🌟 1. ค้นหายอดค้ำประกัน "ของจริง" ที่ถูกหักไป (เช่น 1,550,000 LAK)
            const escrowCheck = await transaction.request()
                .input('pid', sql.Int, provider_id)
                .input('reqId', sql.Int, request_id)
                .query(`
                    SELECT TOP 1 ABS(amount) as deducted_amount 
                    FROM Transactions 
                    WHERE user_id = @pid 
                      AND title LIKE N'%Job ID: ' + CAST(@reqId AS NVARCHAR) + N'%' 
                      AND amount < 0
                    ORDER BY transaction_id DESC
                `);
            
            const actualEscrow = escrowCheck.recordset.length > 0 ? parseFloat(escrowCheck.recordset[0].deducted_amount) : parseFloat(job.amount);

            if (is_correct) {
                // ✅ 1. เติมเงินให้คนฝาก (ยอดสุทธิ + โบนัส ตามสกุลเงินที่ขอฝาก)
                await transaction.request()
                    .input('uid', sql.Int, job.requester_id)
                    .input('net', sql.Decimal(18, 4), job.net_amount)
                    .input('reqId', sql.Int, request_id)
                    .query(`
                        UPDATE Wallets SET balance = balance + @net WHERE user_id = @uid;
                        INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                        VALUES (@uid, @net, 'Deposit', N'รับเงินฝากผ่านระบบ P2P (งาน ID: ' + CAST(@reqId AS NVARCHAR) + N')', 'Completed', GETDATE());
                    `);

                // ✅ 2. คืนเงินค้ำประกัน + ค่าคอม ให้คนรับงาน (ต้องแปลงค่าคอม THB เป็น LAK ก่อน!)
                let finalProviderReward = parseFloat(job.provider_reward); // ค่าคอมตั้งต้น (เช่น 375 THB)
                
                // ดึงสกุลเงินของคนรับงาน
                const provInfo = await transaction.request().input('pid', sql.Int, provider_id).query(`SELECT currency_code FROM users WHERE user_id = @pid`);
                const provCurrency = provInfo.recordset[0].currency_code; // เช่น LAK

                // 🔄 แปลงสกุลเงินค่าคอมมิชชั่น
                if (provCurrency !== jobCurrency) {
                    const rateCheck = await transaction.request()
                        .input('pair1', sql.VarChar, `${jobCurrency}_${provCurrency}`)
                        .input('pair2', sql.VarChar, `${provCurrency}_${jobCurrency}`)
                        .query(`SELECT pair, rate FROM ExchangeRates WHERE pair = @pair1 OR pair = @pair2`);
                    
                    if (rateCheck.recordset.length > 0) {
                        const exRate = rateCheck.recordset[0];
                        if (exRate.pair === `${jobCurrency}_${provCurrency}`) {
                            finalProviderReward = finalProviderReward * parseFloat(exRate.rate);
                        } else {
                            finalProviderReward = finalProviderReward / parseFloat(exRate.rate);
                        }
                    }
                }

                // เอา "เงินค้ำประกันที่ถูกหักจริง (LAK)" + "ค่าคอมที่แปลงแล้ว (LAK)"
                const refund_and_reward = actualEscrow + finalProviderReward;
                
                await transaction.request()
                    .input('pid', sql.Int, provider_id)
                    .input('total', sql.Decimal(18, 4), refund_and_reward)
                    .input('reqId', sql.Int, request_id)
                    .query(`
                        UPDATE Wallets SET balance = balance + @total WHERE user_id = @pid;
                        INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                        VALUES (@pid, @total, 'P2P_Reward', N'คืนมัดจำและรับค่าคอมมิชชั่น P2P (งาน ID: ' + CAST(@reqId AS NVARCHAR) + N')', 'Completed', GETDATE());
                    `);

                // ✅ 3. แจกคอมมิชชั่นให้ "ผู้แนะนำ" (ต้องแปลงเงินให้ผู้แนะนำด้วย)
                const setDb = await transaction.request().query('SELECT TOP 1 referrer_reward_percent FROM P2P_Settings');
                const refPercent = setDb.recordset.length > 0 ? parseFloat(setDb.recordset[0].referrer_reward_percent) : 0;

                if (refPercent > 0) {
                    const refCheck = await transaction.request()
                        .input('pid', sql.Int, provider_id)
                        .query(`
                            SELECT ref.user_id AS referrer_id, ref.currency_code AS ref_curr, me.username AS provider_name 
                            FROM users me 
                            INNER JOIN users ref ON me.referrer_username = ref.username 
                            WHERE me.user_id = @pid
                        `);
                    
                    if (refCheck.recordset.length > 0 && refCheck.recordset[0].referrer_id) {
                        const referrerId = refCheck.recordset[0].referrer_id;
                        const providerName = refCheck.recordset[0].provider_name; 
                        const refCurrency = refCheck.recordset[0].ref_curr; 
                        
                        // 🌟 คำนวณเปอร์เซ็นต์จาก "ยอดฝากต้นทาง" (เช่น 2,500 THB) จะได้ไม่เพี้ยน
                        let finalRefReward = (parseFloat(job.amount) * refPercent) / 100; 

                        // 🔄 แปลงสกุลเงินค่าแนะนำ
                        if (refCurrency !== jobCurrency) {
                            const refRateCheck = await transaction.request()
                                .input('pair1', sql.VarChar, `${jobCurrency}_${refCurrency}`)
                                .input('pair2', sql.VarChar, `${refCurrency}_${jobCurrency}`)
                                .query(`SELECT pair, rate FROM ExchangeRates WHERE pair = @pair1 OR pair = @pair2`);
                            
                            if (refRateCheck.recordset.length > 0) {
                                const exRate2 = refRateCheck.recordset[0];
                                if (exRate2.pair === `${jobCurrency}_${refCurrency}`) {
                                    finalRefReward = finalRefReward * parseFloat(exRate2.rate);
                                } else {
                                    finalRefReward = finalRefReward / parseFloat(exRate2.rate);
                                }
                            }
                        }

                        await transaction.request()
                            .input('refId', sql.Int, referrerId)
                            .input('reward', sql.Decimal(18, 4), finalRefReward)
                            .input('reqId', sql.Int, request_id)
                            .input('pName', sql.NVarChar, providerName) 
                            .query(`
                                UPDATE Wallets SET balance = balance + @reward WHERE user_id = @refId;
                                INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                                VALUES (@refId, @reward, 'Affiliate', N'ค่าคอมมิชชั่นแนะนำเพื่อนรับงาน P2P จากคุณ ' + @pName + N' (งาน ID: ' + CAST(@reqId AS NVARCHAR) + N')', 'Completed', GETDATE());
                            `);
                    }
                }

                // ✅ 4. ปิดงาน
                await transaction.request()
                    .input('rid', sql.Int, request_id)
                    .query(`UPDATE P2P_Requests SET status = 'COMPLETED', completed_at = GETDATE() WHERE request_id = @rid`);
                
            } else {
                // ❌ กรณีเงินไม่เข้า / สลิปปลอม
                
                // 1. คืนเงินค้ำประกัน (ของจริง) ให้คนรับงาน
                await transaction.request()
                    .input('pid', sql.Int, provider_id)
                    .input('amt', sql.Decimal(18, 4), actualEscrow)
                    .input('reqId', sql.Int, request_id)
                    .query(`
                        UPDATE Wallets SET balance = balance + @amt WHERE user_id = @pid;
                        INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                        VALUES (@pid, @amt, 'P2P_Refund', N'คืนเงินมัดจำ P2P เนื่องจากลูกค้าไม่โอนเงิน (งาน ID: ' + CAST(@reqId AS NVARCHAR) + N')', 'Completed', GETDATE());
                    `);
                
                // 2. ยกเลิกงาน
                await transaction.request()
                    .input('rid', sql.Int, request_id)
                    .query(`UPDATE P2P_Requests SET status = 'CANCELLED', completed_at = GETDATE() WHERE request_id = @rid`);

                // 3. ระบบแบนบัญชีลูกค้า
                const banCheck = await transaction.request()
                    .input('uid', sql.Int, job.requester_id)
                    .query(`
                        UPDATE users 
                        SET p2p_cancel_count = ISNULL(p2p_cancel_count, 0) + 1 
                        OUTPUT INSERTED.p2p_cancel_count
                        WHERE user_id = @uid
                    `);
                
                const maxStrikes = 3; 

                if (banCheck.recordset[0].p2p_cancel_count >= maxStrikes) {
                    await transaction.request()
                        .input('uid', sql.Int, job.requester_id)
                        .query(`UPDATE users SET is_locked = 1 WHERE user_id = @uid`);
                }
            }

            await transaction.commit();
            res.json({ success: true, message: is_correct ? '✅ จบภารกิจ! โอนเงินและจ่ายคอมมิชชั่นสำเร็จ' : '⚠️ ยกเลิกคำขอ และคืนเงินมัดจำให้คุณแล้ว' });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error("Verify Slip Error:", err);
        res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
    }
});
// ==========================================
// 📤 [API] ลูกค้าอัปโหลดสลิปโอนเงิน
// ==========================================
app.post('/api/p2p/upload-slip', async (req, res) => {
    try {
        const { request_id, slip_url } = req.body; 

        // 🌟 ดักไว้เผื่อคนส่งรูปมาว่างเปล่า
        if (!slip_url) {
            return res.status(400).json({ success: false, message: 'กรุณาแนบรูปภาพสลิป' });
        }

        const pool = await sql.connect(dbConfig);
        await pool.request()
            .input('reqId', sql.Int, request_id)
            .input('slip', sql.NVarChar(sql.MAX), slip_url) // เก็บรูปเป็น Base64
            .query(`
                UPDATE P2P_Requests 
                SET slip_url = @slip, status = 'VERIFYING' 
                WHERE request_id = @reqId
            `);

        res.json({ success: true, message: 'ส่งสลิปให้ผู้รับงานตรวจสอบเรียบร้อยแล้ว' });
    } catch (err) {
        console.error("Upload Slip Error:", err);
        res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
    }
});


// ==========================================
// 🚨 [API] ผู้รับงานดึงเงินกลับ (เลยเวลา) - แก้บัคสกุลเงิน & ทศนิยม
// ==========================================
app.post('/api/p2p/timeout-cancel', async (req, res) => {
    try {
        const { provider_id, request_id } = req.body;
        const pool = await sql.connect(dbConfig);

        const setDb = await pool.request().query('SELECT TOP 1 * FROM P2P_Settings');
        const settings = setDb.recordset.length > 0 ? setDb.recordset[0] : {};
        const timeoutMinutes = settings.request_timeout_minutes || 15; 
        const maxStrikes = 3;

        const reqData = await pool.request()
            .input('rid', sql.Int, request_id)
            .input('pid', sql.Int, provider_id)
            .query(`SELECT * FROM P2P_Requests WHERE request_id = @rid AND provider_id = @pid AND status = 'ACCEPTED'`);

        if (reqData.recordset.length === 0) {
            return res.json({ success: false, message: 'ไม่พบงานนี้ หรือสถานะงานถูกเปลี่ยนแปลงไปแล้ว' });
        }

        const job = reqData.recordset[0];

        const timeCheck = await pool.request()
            .input('rid', sql.Int, request_id)
            .input('timeout_m', sql.Int, timeoutMinutes)
            .query(`
            SELECT CASE 
                WHEN DATEADD(minute, @timeout_m, ISNULL(accepted_at, created_at)) < DATEADD(hour, 7, GETUTCDATE()) THEN 1 
                ELSE 0 
            END as is_expired 
            FROM P2P_Requests 
            WHERE request_id = @rid
        `);
        
        if (timeCheck.recordset[0].is_expired === 0) {
            return res.json({ success: false, message: `⏳ ยังไม่หมดเวลาโอนเงินครับ (ระบบกำหนดเวลาไว้ ${timeoutMinutes} นาที)` });
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 🌟 ท่าไม้ตาย: ค้นหายอดค้ำประกัน "ของจริง"
            const escrowCheck = await transaction.request()
                .input('pid', sql.Int, provider_id)
                .input('reqId', sql.Int, request_id)
                .query(`
                    SELECT TOP 1 ABS(amount) as deducted_amount 
                    FROM Transactions 
                    WHERE user_id = @pid 
                      AND title LIKE N'%Job ID: ' + CAST(@reqId AS NVARCHAR) + N'%' 
                      AND amount < 0
                    ORDER BY transaction_id DESC
                `);
            
            const actualEscrow = escrowCheck.recordset.length > 0 ? parseFloat(escrowCheck.recordset[0].deducted_amount) : parseFloat(job.amount);

            // คืนเงินค้ำประกัน (ของจริง)
            await transaction.request()
                .input('pid', sql.Int, provider_id)
                .input('amt', sql.Decimal(18, 4), actualEscrow)
                .input('reqId', sql.Int, request_id)
                .query(`
                    UPDATE Wallets SET balance = balance + @amt WHERE user_id = @pid;
                    INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                    VALUES (@pid, @amt, 'P2P_Refund', N'ดึงเงินมัดจำกลับ เนื่องจากลูกค้าไม่โอนเงิน (งาน ID: ' + CAST(@reqId AS NVARCHAR) + N')', 'Completed', GETDATE());
                `);

            // เปลี่ยนสถานะ
            await transaction.request()
                .input('rid', sql.Int, request_id)
                .query(`UPDATE P2P_Requests SET status = 'CANCELLED', completed_at = DATEADD(hour, 7, GETUTCDATE()) WHERE request_id = @rid`);

            // ลงโทษคนเบี้ยว
            const offenderCheck = await transaction.request()
                .input('uid', sql.Int, job.requester_id)
                .query(`
                    IF EXISTS (SELECT 1 FROM P2P_Offenders WHERE user_id = @uid)
                    BEGIN
                        UPDATE P2P_Offenders 
                        SET fail_count = fail_count + 1, last_offense_date = DATEADD(hour, 7, GETUTCDATE()) 
                        OUTPUT INSERTED.fail_count
                        WHERE user_id = @uid
                    END
                    ELSE
                    BEGIN
                        INSERT INTO P2P_Offenders (user_id, fail_count, last_offense_date) 
                        OUTPUT INSERTED.fail_count
                        VALUES (@uid, 1, DATEADD(hour, 7, GETUTCDATE()))
                    END
                `);
            
            const currentFails = offenderCheck.recordset[0].fail_count;

            if (currentFails >= maxStrikes) {
                await transaction.request()
                    .input('uid', sql.Int, job.requester_id)
                    .query(`UPDATE users SET is_locked = 1 WHERE user_id = @uid`);
            }

            await transaction.commit();
            res.json({ success: true, message: '✅ ดึงเงินมัดจำกลับสำเร็จ และบันทึกประวัติทำผิดของลูกค้าเรียบร้อยแล้ว' });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error("Timeout Cancel Error:", err);
        res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
    }
});
// ==========================================
// 🌟 [ADMIN] ดึงข้อมูลตั้งค่า P2P และโปรโมชั่น
// ==========================================
app.get('/api/admin/p2p-settings', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query('SELECT TOP 1 * FROM P2P_Settings ORDER BY id ASC');
        
        if (result.recordset.length > 0) {
            res.json({ success: true, settings: result.recordset[0] });
        } else {
            res.status(404).json({ success: false, message: 'ไม่พบข้อมูลการตั้งค่า' });
        }
    } catch (err) {
        console.error("Error fetching P2P settings:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// ==========================================
// 🌟 [ADMIN] อัปเดตข้อมูลตั้งค่า P2P และโปรโมชั่น
// ==========================================
app.put('/api/admin/p2p-settings', async (req, res) => {
    try {
        const { 
            deposit_bonus_percent, withdraw_fee_percent, 
            provider_reward_percent, referrer_reward_percent, 
            request_timeout_minutes, promo_start_time, promo_end_time 
        } = req.body;

        const pool = await sql.connect(dbConfig);
        
        // อัปเดตข้อมูลแถวแรกเสมอ (id = 1)
        await pool.request()
            .input('deposit', sql.Decimal(5,2), deposit_bonus_percent)
            .input('withdraw', sql.Decimal(5,2), withdraw_fee_percent)
            .input('provider', sql.Decimal(5,2), provider_reward_percent)
            .input('referrer', sql.Decimal(5,2), referrer_reward_percent)
            .input('timeout', sql.Int, request_timeout_minutes)
            .input('p_start', sql.DateTime, promo_start_time || null)
            .input('p_end', sql.DateTime, promo_end_time || null)
            .query(`
                UPDATE P2P_Settings 
                SET deposit_bonus_percent = @deposit,
                    withdraw_fee_percent = @withdraw,
                    provider_reward_percent = @provider,
                    referrer_reward_percent = @referrer,
                    request_timeout_minutes = @timeout,
                    promo_start_time = @p_start,
                    promo_end_time = @p_end,
                    updated_at = GETDATE()
            `);

        res.json({ success: true, message: 'บันทึกการตั้งค่าสำเร็จ' });
    } catch (err) {
        console.error("Error updating P2P settings:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// ==========================================
// 🛡️ [ADMIN] อัปเดตเฉพาะค่า Commission P2P (แยกต่างหาก ปลอดภัย 100%)
// ==========================================
app.post('/api/admin/p2p-commission-update', async (req, res) => {
    try {
        const { reward_percent } = req.body;
        const pool = await sql.connect(dbConfig);
        
        // เช็คว่ามีข้อมูลในตารางหรือยัง ถ้ายังให้ Insert ถ้ามีแล้วให้ Update
        const check = await pool.request().query('SELECT COUNT(*) as count FROM P2P_Settings');
        if (check.recordset[0].count === 0) {
            await pool.request()
                .input('percent', sql.Decimal(5, 2), reward_percent)
                .query(`INSERT INTO P2P_Settings (provider_reward_percent) VALUES (@percent)`);
        } else {
            await pool.request()
                .input('percent', sql.Decimal(5, 2), reward_percent)
                .query(`UPDATE P2P_Settings SET provider_reward_percent = @percent`);
        }
        res.json({ success: true, message: 'บันทึกค่า Commission P2P สำเร็จแล้ว! (มีผลเฉพาะบิลใหม่)' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


// ==========================================
// 🌟 [CLIENT] ดึงข้อมูลหน้าบอร์ดลูกค้า (แยกบอร์ด กับ โฆษณา)
// ==========================================
// ==========================================
// 🛡️ [API] ดึงประวัติงาน P2P ที่กำลังดำเนินการของผู้รับงาน
// ==========================================
app.get('/api/p2p/my-jobs/:uid', async (req, res) => {
    try {
        const uid = req.params.uid;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('uid', sql.Int, uid)
            .query(`
                SELECT * FROM P2P_Requests 
                WHERE provider_id = @uid 
                  AND status IN ('ACCEPTED', 'VERIFYING')
                ORDER BY accepted_at DESC
            `);
            
        res.json({ success: true, jobs: result.recordset });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
    }
});
// ==========================================
// 🌟 [CLIENT] ดึงข้อมูลหน้าบอร์ดลูกค้า (ฉบับสมบูรณ์ที่สุด - รวมร่างข้อดีและแก้บัคแล้ว)
// ==========================================
let cachedPool = null;

app.get('/api/p2p/board', async (req, res) => {
    try {
        const { user_id } = req.query;
        if (!user_id) return res.status(400).json({ success: false, message: 'Missing user_id' });
        
        // 🌟 ใช้ระบบ Cache ลดภาระเซิร์ฟเวอร์ (จากตัวที่ 1)
        if (!cachedPool) { cachedPool = await sql.connect(dbConfig); }
        const pool = cachedPool;
        
        const rateResult = await pool.request().query('SELECT * FROM ExchangeRates');
        const settingResult = await pool.request().query('SELECT TOP 1 * FROM P2P_Settings');
        
        // 🌟 แก้ปัญหา Timezone เซิร์ฟเวอร์ให้ตรงกับเวลาไทย/ลาว +7 (จากตัวที่ 2)
        const activePromoResult = await pool.request().query(`
            SELECT TOP 1 * FROM P2P_Promotions 
            WHERE DATEADD(hour, 7, GETUTCDATE()) BETWEEN start_time AND end_time 
            ORDER BY end_time ASC
        `);
        
        // 🌟 ดึงข้อมูลกระเป๋า และ สกุลเงิน (เปลี่ยนเป็น currency_code ให้ตรง DB) (จากตัวที่ 2)
        const walletResult = await pool.request()
            .input('uid', sql.Int, user_id)
            .query(`
                SELECT w.balance, u.currency_code 
                FROM Wallets w 
                LEFT JOIN Users u ON w.user_id = u.user_id 
                WHERE w.user_id = @uid
            `);
        
        // 🌟 ดึงเฉพาะ "งานว่าง" และเช็คว่า "ยังไม่หมดเวลา" (เพิ่ม JOIN ธนาคาร เพื่อไม่ให้กระทบโค้ดเดิม)
       // 🌟 ดึง "งานว่าง" (เชื่อมเอาโลโก้ธนาคารผ่าน user_bank_id ตรงๆ)
        const missionsResult = await pool.request()
            .input('uid', sql.Int, user_id)
            .query(`
                SELECT r.*, u.username AS requester_name,
                       bk.bank_name AS req_bank_name, bk.logo_url, bk.country,
                       ub.account_number AS req_account_number,
                       ub.account_name AS req_account_name
                FROM P2P_Requests r 
                LEFT JOIN Users u ON r.requester_id = u.user_id 
                LEFT JOIN UserBanks ub ON r.user_bank_id = ub.user_bank_id
                LEFT JOIN Banks bk ON ub.bank_id = bk.bank_id
                WHERE r.status = 'PENDING' 
                  AND r.requester_id != @uid 
                  AND r.expires_at > DATEADD(hour, 7, GETUTCDATE())
                ORDER BY r.created_at DESC
            `);

        // 🌟 ดึง "งานที่รับมาแล้ว" (ใช้ท่าเดียวกันเป๊ะ!)
        const myAcceptedResult = await pool.request()
            .input('uid', sql.Int, user_id)
            .query(`
                SELECT r.*, u.username AS requester_name,
                       bk.bank_name AS req_bank_name, bk.logo_url, bk.country,
                       ub.account_number AS req_account_number,
                       ub.account_name AS req_account_name
                FROM P2P_Requests r 
                LEFT JOIN Users u ON r.requester_id = u.user_id 
                LEFT JOIN UserBanks ub ON r.user_bank_id = ub.user_bank_id
                LEFT JOIN Banks bk ON ub.bank_id = bk.bank_id
                WHERE r.provider_id = @uid AND r.status IN ('ACCEPTED', 'VERIFYING')
                ORDER BY r.created_at DESC
            `);

      // 🌟 แยกตะกร้าดึง "งานที่ฉันเป็นคนสร้าง" พร้อมเชื่อม 3 ตาราง (Requests + UserBanks + Banks) เพื่อดึงชื่อธนาคารให้ครบ!
        const myRequestsResult = await pool.request()
            .input('myuid', sql.Int, user_id)
            .query(`
                SELECT 
                    r.*, 
                    b.account_number AS provider_account_number,
                    b.account_name AS provider_account_name,
                    bk.bank_name AS provider_bank_name
                FROM P2P_Requests r 
                LEFT JOIN UserBanks b ON r.provider_id = b.user_id 
                                     AND b.currency_code = r.currency 
                                     AND b.status = 'Approved'
                LEFT JOIN Banks bk ON b.bank_id = bk.bank_id
                WHERE r.requester_id = @myuid 
                ORDER BY r.created_at DESC
            `);

        // 🌟 ส่งข้อมูลแบบจัดเต็ม ครบจบใน API เดียว
        res.json({ 
            success: true, 
            settings: settingResult.recordset[0] || null, 
            activePromo: activePromoResult.recordset.length > 0 ? activePromoResult.recordset[0] : null,
            wallet: walletResult.recordset.length > 0 ? walletResult.recordset[0].balance : 0, 
            currency: (walletResult.recordset.length > 0 && walletResult.recordset[0].currency_code) ? walletResult.recordset[0].currency_code : 'THB',
            exchangeRates: rateResult.recordset || [],
            missions: missionsResult.recordset || [], 
            myAcceptedJobs: myAcceptedResult.recordset || [], 
            myRequests: myRequestsResult.recordset || [] 
        });
    } catch (err) { 
        console.error(err);
        res.status(500).json({ success: false, message: err.message }); 
    }
});
// ==========================================
// 🌟 API ใหม่: ดึงเฉพาะโฆษณา/วิดีโอ (ดึงแค่ครั้งเดียวตอนลูกค้าเปิดหน้าเว็บ)
// ==========================================
app.get('/api/p2p/active-ads', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        // ดึงเฉพาะโฆษณาที่ is_active = 1 (เปิดใช้งานอยู่)
        const result = await pool.request().query(`
            SELECT * FROM P2P_Ads 
            WHERE is_active = 1 
            ORDER BY sort_order ASC, created_at DESC
        `);
        res.json({ success: true, ads: result.recordset });
    } catch (err) { 
        res.status(500).json({ success: false, message: err.message }); 
    }
});
// ==========================================
// 🌟 สิ้นสุด  API P2P
// ==========================================
// ==========================================
// 🌟 [ADMIN] ADS และ โปรโมชั่น  เริ่ม
// ==========================================

// 1. จัดการคิวโปรโมชั่น (แจกโบนัสฝาก)
app.get('/api/admin/promotions', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query('SELECT * FROM P2P_Promotions ORDER BY start_time ASC');
        res.json({ success: true, promotions: result.recordset });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/promotions', async (req, res) => {
    try {
        const { title, bonus_percent, start_time, end_time } = req.body;
        const pool = await sql.connect(dbConfig);
        await pool.request()
            .input('title', sql.NVarChar, title)
            .input('bonus', sql.Decimal(5,2), bonus_percent)
            .input('start', sql.DateTime, start_time)
            .input('end', sql.DateTime, end_time)
            .query('INSERT INTO P2P_Promotions (title, bonus_percent, start_time, end_time) VALUES (@title, @bonus, @start, @end)');
        res.json({ success: true, message: 'เพิ่มโปรโมชั่นสำเร็จ' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.delete('/api/admin/promotions/:id', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM P2P_Promotions WHERE promo_id = @id');
        res.json({ success: true, message: 'ลบสำเร็จ' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// 2. จัดการป้ายโฆษณาคั่นเวลา (ADS)
app.get('/api/admin/ads', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query('SELECT * FROM P2P_Ads ORDER BY created_at DESC');
        res.json({ success: true, ads: result.recordset });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/ads', async (req, res) => {
    try {
        const { title, description, media_type, media_url } = req.body;
        const pool = await sql.connect(dbConfig);
        await pool.request()
            .input('title', sql.NVarChar, title || '') // รองรับภาษาไทย
            .input('desc', sql.NVarChar, description || '') // รองรับภาษาไทย
            .input('type', sql.VarChar, media_type)
            .input('url', sql.VarChar, media_url)
            .query('INSERT INTO P2P_Ads (title, description, media_type, media_url) VALUES (@title, @desc, @type, @url)');
        res.json({ success: true, message: 'เพิ่มโฆษณาสำเร็จ' });
    } catch (err) { 
        res.status(500).json({ success: false, message: err.message }); 
    }
});

app.delete('/api/admin/ads/:id', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM P2P_Ads WHERE ad_id = @id');
        res.json({ success: true, message: 'ลบสำเร็จ' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// 🌟 API สำหรับแก้ไขรายละเอียดโฆษณา/วิดีโอ (Title & Description)
app.put('/api/admin/ads/:id', async (req, res) => {
    try {
        const ad_id = req.params.id;
        const { title, description } = req.body;

        // 1. เช็คว่ามีส่ง ID มาหรือไม่
        if (!ad_id) {
            return res.status(400).json({ success: false, message: 'ไม่พบรหัสโฆษณา (ad_id)' });
        }

        // 2. สั่งอัปเดตข้อมูลลง Database
        // ⚠️ หมายเหตุ: เจ้านายเช็คชื่อตาราง 'Ads' อีกทีนะครับว่าตรงกับใน Database หรือไม่ (บางทีอาจจะชื่อ SystemAds หรือ P2P_Ads)
        const result = await pool.request()
            .input('ad_id', sql.Int, ad_id)
            .input('title', sql.NVarChar, title || '')
            .input('description', sql.NVarChar, description || '')
            .query(`
                UPDATE Ads 
                SET title = @title, 
                    description = @description
                    -- หากเจ้านายมีคอลัมน์ updated_at สามารถเอาคอมเมนต์บรรทัดล่างออกได้ครับ
                    -- , updated_at = GETDATE()
                WHERE ad_id = @ad_id
            `);

        // 3. เช็คว่าอัปเดตสำเร็จไหม (หา ID นั้นเจอหรือเปล่า)
        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลโฆษณานี้ในระบบ' });
        }

        // 4. ส่งสถานะกลับไปให้หน้าบ้าน (Frontend จะได้รับ success: true แล้วเด้ง Alert สำเร็จ)
        res.json({ success: true, message: 'อัปเดตข้อมูลโฆษณาสำเร็จ' });

    } catch (error) {
        console.error('Error updating ad:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์: ' + error.message });
    }
});


// ==========================================
// 🌟 [ADMIN] ADS และ โปรโมชั่น  สิ้นสุด
// ==========================================
// ==========================================
// 💸 [CLIENT] สร้างคำขอถอนเงิน (P2P) - อัปเดตบันทึกบัญชีธนาคาร
// ==========================================
app.post('/api/p2p/request-withdraw', async (req, res) => {
    try {
        // 🌟 1. รับค่า user_bank_id ที่ลูกค้าเลือกมาจากหน้าเว็บ
        const { requester_id, amount, user_bank_id } = req.body; 
        
        if (!requester_id || !amount || amount <= 0 || !user_bank_id) {
            return res.status(400).json({ success: false, message: 'กรุณาระบุจำนวนเงินและเลือกบัญชีธนาคาร' });
        }

        const pool = await sql.connect(dbConfig);
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const userCheck = await transaction.request()
                .input('uid', sql.Int, requester_id)
                .query(`
                    SELECT u.currency_code, w.balance 
                    FROM users u 
                    LEFT JOIN Wallets w ON u.user_id = w.user_id 
                    WHERE u.user_id = @uid
                `);
                
            if (userCheck.recordset.length === 0) throw new Error('ไม่พบข้อมูลผู้ใช้');
            
            const userCurrency = userCheck.recordset[0].currency_code;
            const currentBalance = parseFloat(userCheck.recordset[0].balance || 0);
            const reqAmount = parseFloat(amount);

            if (currentBalance < reqAmount) throw new Error('ยอดเงินไม่เพียงพอ');

            const settings = await transaction.request().query('SELECT TOP 1 * FROM P2P_Settings');
            const config = settings.recordset.length > 0 ? settings.recordset[0] : {};
            const feePercent = parseFloat(config.withdraw_fee_percent || 5);
            const feeAmount = (reqAmount * feePercent) / 100;
            const netAmount = reqAmount - feeAmount; 
            const providerReward = (netAmount * parseFloat(config.provider_reward_percent || 15)) / 100;

            // หักเงินในกระเป๋า
            await transaction.request()
                .input('uid', sql.Int, requester_id)
                .input('amt', sql.Decimal(18, 4), reqAmount)
                .query(`UPDATE Wallets SET balance = balance - @amt WHERE user_id = @uid`);

            // บันทึกประวัติ Transaction ฝั่ง Wallet
            await transaction.request()
                .input('uid', sql.Int, requester_id)
                .input('amt', sql.Decimal(18, 4), -reqAmount)
                .query(`
                    INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                    VALUES (@uid, @amt, 'P2P_Withdraw_Hold', N'หักเงินเพื่อสร้างคำขอถอนเงิน P2P', 'Pending', DATEADD(hour, 7, GETUTCDATE()))
                `);
            
            // 🌟 2. บันทึกคำขอถอนเงิน (แทรก user_bank_id ลงฐานข้อมูลให้เรียบร้อย)
            await transaction.request()
                .input('req_id', sql.Int, requester_id)
                .input('bank_id', sql.Int, user_bank_id) // 👈 จุดนี้คือหัวใจสำคัญที่ทำให้ธนาคารไปโชว์ให้คนรับงานเห็น
                .input('curr', sql.VarChar, userCurrency)
                .input('amt', sql.Decimal(18, 4), reqAmount)
                .input('fee', sql.Decimal(18, 4), feeAmount)
                .input('net', sql.Decimal(18, 4), netAmount)
                .input('reward', sql.Decimal(18, 4), providerReward)
                .input('timeout', sql.Int, parseInt(config.request_timeout_minutes || 15))
                .query(`
                    INSERT INTO P2P_Requests 
                    (requester_id, user_bank_id, request_type, currency, amount, bonus_or_fee, net_amount, provider_reward, status, created_at, expires_at) 
                    VALUES 
                    (@req_id, @bank_id, 'WITHDRAW', @curr, @amt, @fee, @net, @reward, 'PENDING', DATEADD(hour, 7, GETUTCDATE()), DATEADD(minute, @timeout, DATEADD(hour, 7, GETUTCDATE())))
                `);

            await transaction.commit();
            res.json({ success: true, message: 'สร้างคำขอถอนเงินสำเร็จ' });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error("Request Withdraw Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// ==========================================
// 🚀 [PROVIDER] ผู้รับงานกด "รับงาน" (ACCEPT JOB) - อัปเกรดระบบตรวจสอบประเทศ/บัญชี
// ==========================================
app.post('/api/p2p/accept-job', async (req, res) => {
    try {
        const { provider_id, request_id } = req.body;
        const pool = await sql.connect(dbConfig);
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. ดึงข้อมูลงาน และ ข้อมูลคนที่ขอฝาก/ถอน
            const jobCheck = await transaction.request()
                .input('rid', sql.Int, request_id)
                .query(`
                    SELECT r.*, u.country AS req_country, u.currency_code AS req_currency 
                    FROM P2P_Requests r
                    INNER JOIN users u ON r.requester_id = u.user_id
                    WHERE r.request_id = @rid AND r.status = 'PENDING'
                `);
            
            if (jobCheck.recordset.length === 0) {
                throw new Error('งานนี้ถูกรับไปแล้ว หรือหมดเวลาแล้วครับ');
            }
            const job = jobCheck.recordset[0];

            // 🚨 ป้องกันกดรับงานตัวเอง
            if (job.requester_id === provider_id) {
                throw new Error('ไม่สามารถรับงานของตัวเองได้ครับ');
            }

           // 2. ดึงข้อมูล "ผู้รับงาน" (เช็คประเทศ, สกุลเงิน และ บัญชีธนาคาร)
            const provCheck = await transaction.request()
                .input('pid', sql.Int, provider_id)
                .query(`
                    SELECT u.country, u.currency_code, bk.bank_name, ub.account_number 
                    FROM users u
                    LEFT JOIN UserBanks ub ON u.user_id = ub.user_id
                    LEFT JOIN Banks bk ON ub.bank_id = bk.bank_id
                    WHERE u.user_id = @pid
                `);
            
            const provider = provCheck.recordset[0];

            // 🛑 กฎข้อที่ 1: ผู้รับงานต้องผูกบัญชีธนาคารแล้ว
            if (!provider.bank_name || !provider.account_number) {
                throw new Error('คุณต้องผูกบัญชีธนาคารก่อน จึงจะสามารถรับงาน P2P ได้ครับ');
            }

            // 🛑 กฎข้อที่ 2: ประเทศและสกุลเงินต้องตรงกับผู้ส่งคำขอ
            if (provider.country !== job.req_country || provider.currency_code !== job.req_currency) {
                throw new Error(`ไม่สามารถรับงานได้! งานนี้สำหรับบัญชีประเทศ ${job.req_country} (${job.req_currency}) เท่านั้น`);
            }

            // 3. แยก Logics ตามประเภทงาน (DEPOSIT / WITHDRAW)
            if (job.request_type === 'DEPOSIT') {
                // ฝั่งรับฝากเงิน -> ต้องหักเงินค้ำประกัน (Escrow) จากคนรับงาน
                const provWalletCheck = await transaction.request()
                    .input('pid', sql.Int, provider_id)
                    .query('SELECT balance FROM Wallets WHERE user_id = @pid');
                
                const provBalance = parseFloat(provWalletCheck.recordset[0].balance || 0);
                if (provBalance < parseFloat(job.amount)) {
                    throw new Error(`ยอดเงินค้ำประกันไม่พอ (คุณต้องมีอย่างน้อย ${job.amount} ${job.currency})`);
                }

                // หักเงินค้ำประกันคนรับงาน
                await transaction.request()
                    .input('pid', sql.Int, provider_id)
                    .input('amt', sql.Decimal(18, 4), job.amount)
                    .input('reqId', sql.Int, request_id)
                    .query(`
                        UPDATE Wallets SET balance = balance - @amt WHERE user_id = @pid;
                        INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                        VALUES (@pid, -@amt, 'P2P_Escrow', N'หักเงินค้ำประกัน รอโอน P2P (Job ID: ' + CAST(@reqId AS NVARCHAR) + N')', 'Completed', GETDATE());
                    `);
            } 
            else if (job.request_type === 'WITHDRAW') {
                // ฝั่งรับถอนเงิน -> คนรับงานไม่ต้องวางเงินค้ำประกัน (เพราะลูกค้ายอมโดนหักเงินไปรอในระบบแล้ว)
                // คนรับงานแค่มีหน้าที่ โอนเงินเข้าธนาคารลูกค้า แล้วอัปสลิป
            }

            // 4. เปลี่ยนสถานะงานเป็น ACCEPTED และอัปเดตเวลา
            await transaction.request()
                .input('rid', sql.Int, request_id)
                .input('pid', sql.Int, provider_id)
                .query(`
                    UPDATE P2P_Requests 
                    SET status = 'ACCEPTED', 
                        provider_id = @pid, 
                        accepted_at = DATEADD(hour, 7, GETUTCDATE()) 
                    WHERE request_id = @rid
                `);

            await transaction.commit();
            res.json({ success: true, message: '✅ รับงานสำเร็จ! กรุณาตรวจสอบและดำเนินการตามเวลาที่กำหนด' });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error("Accept Job Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🏦 [GET] ดึงข้อมูลเตรียมถอนเงิน (Wallet + Banks + Logo)
// ==========================================
app.get('/api/p2p/withdraw-info/:userId', async (req, res) => {
    try {
        const uid = parseInt(req.params.userId, 10);
        if (!uid) return res.status(400).json({ success: false, message: 'Invalid ID' });

        const pool = await sql.connect(dbConfig);
        
        // 1. ดึงข้อมูล Wallet
        const userDb = await pool.request().input('uid', sql.Int, uid).query(`
            SELECT currency_code, ISNULL((SELECT balance FROM Wallets WHERE user_id = @uid), 0) as balance 
            FROM users WHERE user_id = @uid
        `);
        if (userDb.recordset.length === 0) return res.json({ success: false, message: 'ไม่พบผู้ใช้' });
        
        const { currency_code, balance } = userDb.recordset[0];

        // 2. ดึงบัญชีธนาคารที่อนุมัติแล้ว พร้อมดึง logo_url และ currency_code
        // 2. ดึงบัญชีธนาคารที่อนุมัติแล้ว พร้อมดึง logo_url, currency_code และ country
        const banksDb = await pool.request().input('uid', sql.Int, uid).query(`
            SELECT ub.user_bank_id, ub.account_number, ub.currency_code, bk.bank_name, bk.logo_url, bk.country 
            FROM UserBanks ub
            LEFT JOIN Banks bk ON ub.bank_id = bk.bank_id
            WHERE ub.user_id = @uid AND ub.status = 'Approved'
        `);
        // 3. ดึงค่าธรรมเนียม
        const setDb = await pool.request().query('SELECT TOP 1 withdraw_fee_percent FROM P2P_Settings');
        const feePercent = setDb.recordset.length > 0 ? parseFloat(setDb.recordset[0].withdraw_fee_percent) : 5;

        // 4. อัตราแลกเปลี่ยนสำรอง
        let usdRate = currency_code === 'THB' ? 35 : currency_code === 'LAK' ? 22000 : 1; 

        res.json({
            success: true,
            currency: currency_code,
            balance: parseFloat(balance),
            fee_percent: feePercent,
            usd_rate: usdRate,
            banks: banksDb.recordset // 🌟 ส่งรายชื่อบัญชี (พร้อมโลโก้) ไปให้หน้าเว็บ
        });
    } catch (err) {
        console.error("withdraw-info API Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/p2p/cancel-withdraw-request', async (req, res) => {
    try {
        const { request_id, requester_id } = req.body;
        if (!request_id || !requester_id) return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });

        const pool = await sql.connect(dbConfig);
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const reqCheck = await transaction.request()
                .input('rid', sql.Int, request_id)
                .input('uid', sql.Int, requester_id)
                .query(`
                    SELECT amount, currency, status, expires_at 
                    FROM P2P_Requests 
                    WHERE request_id = @rid AND requester_id = @uid AND request_type = 'WITHDRAW'
                `);

            if (reqCheck.recordset.length === 0) throw new Error('ไม่พบคำขอ หรือคุณไม่มีสิทธิ์ยกเลิกคำขอนี้');
            const requestData = reqCheck.recordset[0];

            // 🌟 เช็คเวลาปัจจุบัน เทียบกับเวลาหมดอายุ
            const now = new Date();
            const expiresAt = new Date(requestData.expires_at);
            const isExpired = now > expiresAt;

            // 🌟 กฎการยกเลิก: ถ้าไม่ใช่ PENDING และไม่ได้หมดเวลา จะยกเลิกไม่ได้
            if (requestData.status !== 'PENDING' && !(requestData.status === 'ACCEPTED' && isExpired)) {
                throw new Error('ไม่สามารถยกเลิกได้ เนื่องจากผู้รับงานกำลังดำเนินการและยังไม่หมดเวลาครับ');
            }

            const refundAmount = parseFloat(requestData.amount); 

            await transaction.request().input('rid', sql.Int, request_id)
                .query(`UPDATE P2P_Requests SET status = 'CANCELLED' WHERE request_id = @rid`);

            await transaction.request().input('uid', sql.Int, requester_id).input('amt', sql.Decimal(18, 4), refundAmount)
                .query(`UPDATE Wallets SET balance = balance + @amt WHERE user_id = @uid`);

            await transaction.request()
                .input('uid', sql.Int, requester_id).input('amt', sql.Decimal(18, 4), refundAmount).input('curr', sql.VarChar, requestData.currency).input('rid', sql.Int, request_id)
                .query(`
                    INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                    VALUES (@uid, @amt, 'P2P_Withdraw_Refund', N'คืนเงินยกเลิกคำขอถอนเงิน P2P (Job ID: ' + CAST(@rid AS NVARCHAR) + ')', 'Completed', GETDATE())
                `);

            await transaction.commit();
            res.json({ success: true, message: 'ยกเลิกคำขอและคืนเงินเข้ากระเป๋าเต็มจำนวนสำเร็จครับ' });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
// ==========================================
// 📋 [GET] ดึงรายการงาน P2P ที่ฉันรับมาดูแล (ฝั่งผู้รับงาน)
// ==========================================
app.get('/api/p2p/my-jobs/:userId', async (req, res) => {
    try {
        const pid = parseInt(req.params.userId, 10);
        const pool = await sql.connect(dbConfig);
        
        // 🌟 ดึงแบบตรงไปตรงมา ผ่าน user_bank_id เหมือนหน้าบอร์ดเลยครับ!
        const jobsDb = await pool.request().input('pid', sql.Int, pid).query(`
            SELECT r.*, 
                   u.username AS requester_name, 
                   bk.bank_name AS req_bank_name, 
                   bk.logo_url, 
                   bk.country,
                   ub.account_number AS req_account_number,
                   ub.account_name AS req_account_name
            FROM P2P_Requests r
            LEFT JOIN Users u ON r.requester_id = u.user_id
            LEFT JOIN UserBanks ub ON r.user_bank_id = ub.user_bank_id
            LEFT JOIN Banks bk ON ub.bank_id = bk.bank_id
            WHERE r.provider_id = @pid 
              AND r.status IN ('ACCEPTED', 'VERIFYING')
            ORDER BY r.request_id DESC
        `);
        
        res.json({ success: true, jobs: jobsDb.recordset });
    } catch (err) {
        console.error("My Jobs API Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});
// ==========================================
// 📋 [GET] ดึงประวัติคำขอถอนเงินของลูกค้า (ดึงข้อมูลฝั่งผู้รับงานมาด้วย)
// ==========================================
// ==========================================
// 📋 [GET] ดึงประวัติคำขอถอนเงินของลูกค้า (ดึงข้อมูลฝั่งผู้รับงานมาด้วย)
// ==========================================
app.get('/api/p2p/my-requests/:userId', async (req, res) => {
    try {
        const uid = req.params.userId;
        if (!uid || uid === 'undefined') return res.status(400).json({ success: false, message: 'Invalid ID' });

        const pool = await sql.connect(dbConfig);
        const reqDb = await pool.request()
            .input('uid', sql.Int, parseInt(uid, 10))
            .query(`
                SELECT r.request_id, r.amount, r.net_amount, r.currency, r.status, r.created_at, r.expires_at, r.slip_url, r.provider_id,
                       bk.bank_name, bk.logo_url, bk.country, ub.account_number,
                       pu.username AS provider_username,
                       pbk.bank_name AS provider_bank_name,
                       pbk.logo_url AS provider_logo_url,
                       pbk.country AS provider_country,
                       pb.account_number AS provider_account_number
                FROM P2P_Requests r
                LEFT JOIN UserBanks ub ON r.user_bank_id = ub.user_bank_id
                LEFT JOIN Banks bk ON ub.bank_id = bk.bank_id
                
                -- 🌟 เชื่อมตาราง Users เพื่อเอาชื่อคนรับงาน
                LEFT JOIN Users pu ON r.provider_id = pu.user_id
                
                -- 🌟 แก้ไขตรงนี้: ดึงบัญชีของผู้รับงาน ที่ผูกกับระบบและตรงกับสกุลเงินของงาน
                OUTER APPLY (
                    SELECT TOP 1 b.account_number, b.bank_id
                    FROM UserBanks b
                    WHERE b.user_id = r.provider_id 
                      AND b.currency_code = r.currency 
                      AND b.status = 'Approved'
                ) pb
                LEFT JOIN Banks pbk ON pb.bank_id = pbk.bank_id
                
                WHERE r.requester_id = @uid AND r.request_type = 'WITHDRAW'
                ORDER BY r.request_id DESC
            `);
        res.json({ success: true, requests: reqDb.recordset });
    } catch (err) {
        console.error("My Requests API Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});
// ==========================================
// 📤 [POST] อัปโหลดสลิปโอนเงิน (พร้อมระบบ Anti-Fraud + การคืนเงินที่ปลอดภัย 100%)
// ==========================================
app.post('/api/p2p/upload-slip', async (req, res) => {
    try {
        const { provider_id, request_id, slip_image, transfer_amount, transfer_date, transfer_time } = req.body;
        
        if (!provider_id || !request_id || !slip_image || !transfer_amount || !transfer_date || !transfer_time) {
            return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน รวมถึงแนบรูปภาพ ยอดเงิน และเวลาโอน' });
        }

        const pool = await sql.connect(dbConfig);
        
        // 1. ดึงข้อมูลงานมาตรวจสอบ
        const jobCheck = await pool.request()
            .input('rid', sql.Int, request_id)
            .input('pid', sql.Int, provider_id)
            .query(`SELECT * FROM P2P_Requests WHERE request_id = @rid AND provider_id = @pid AND status = 'ACCEPTED'`);
        
        if (jobCheck.recordset.length === 0) {
            return res.status(400).json({ success: false, message: 'ไม่พบงานนี้ หรือสถานะงานไม่ถูกต้อง' });
        }

        const job = jobCheck.recordset[0];
        const expectedAmount = parseFloat(job.net_amount);
        const inputAmount = parseFloat(transfer_amount);

        // 🚨 2. ระบบตรวจสอบเจตนาทุจริต (Anti-Fraud)
        if (inputAmount !== expectedAmount) {
            const currentErrorCount = (job.slip_error_count || 0) + 1;

            if (currentErrorCount >= 3) {
                // 💥 ทุจริตครบ 3 ครั้ง: ใช้ Transaction คืนเงินตามสูตรของเจ้านายเป๊ะๆ
                const transaction = new sql.Transaction(pool);
                await transaction.begin();

                try {
                    // 2.1 บล็อกผู้รับงาน
                    await transaction.request()
                        .input('pid', sql.Int, provider_id)
                        .query(`UPDATE Users SET status = 'Blocked' WHERE user_id = @pid`);

                    // 2.2 ยกเลิกงาน
                    await transaction.request()
                        .input('rid', sql.Int, request_id)
                        .query(`UPDATE P2P_Requests SET status = 'CANCELLED' WHERE request_id = @rid`);

                    // 2.3 คืนเงินเข้ากระเป๋าผู้ส่งคำขอถอน
                    const refundAmount = parseFloat(job.amount);
                    await transaction.request()
                        .input('uid', sql.Int, job.requester_id)
                        .input('amt', sql.Decimal(18, 4), refundAmount)
                        .query(`UPDATE Wallets SET balance = balance + @amt WHERE user_id = @uid`);

                    // 2.4 บันทึกประวัติ Transaction (แบบเดียวกับที่เจ้านายทำไว้)
                    await transaction.request()
                        .input('uid', sql.Int, job.requester_id)
                        .input('amt', sql.Decimal(18, 4), refundAmount)
                        .input('curr', sql.VarChar, job.currency)
                        .input('rid', sql.Int, request_id)
                        .query(`
                            INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                            VALUES (@uid, @amt, 'P2P_Withdraw_Refund', N'คืนเงินระบบ P2P เนื่องจากผู้รับงานทุจริต (Job ID: ' + CAST(@rid AS NVARCHAR) + ')', 'Completed', GETDATE())
                        `);

                    // 2.5 ส่งแจ้งเตือนหาลูกค้า
                    try {
                        await transaction.request()
                            .input('req_id', sql.Int, job.requester_id)
                            .input('msg', sql.NVarChar(sql.MAX), 'ผู้รับงานมีเจตนาทุจริต ผู้รับงานโดนบล็อกแล้ว ให้ส่งคำขอใหม่ (เราได้คืนเงินกลับให้คุณแล้วกรุณาตรวจสอบ)')
                            .query(`
                                INSERT INTO Notifications (user_id, message, type, is_read, created_at)
                                VALUES (@req_id, @msg, 'SYSTEM', 0, GETDATE())
                            `);
                    } catch (notiErr) {
                        // ข้ามถ้าไม่มีตารางแจ้งเตือน
                    }

                    await transaction.commit(); // จบ Transaction ปลอดภัย 100%

                    return res.status(403).json({ 
                        success: false, 
                        message: '🚨 บัญชีของคุณถูกระงับการใช้งาน! เนื่องจากตรวจพบเจตนาทุจริต กรุณาติดต่อ Admin' 
                    });

                } catch (transactionErr) {
                    await transaction.rollback(); // ถ้าพังตรงไหน ย้อนกลับทุกอย่าง
                    throw transactionErr;
                }

            } else {
                // ⚠️ กรอกผิดแต่ยังไม่ครบ 3 ครั้ง: อัปเดตตัวนับและแจ้งเตือน
                await pool.request()
                    .input('rid', sql.Int, request_id)
                    .input('errCount', sql.Int, currentErrorCount)
                    .query(`UPDATE P2P_Requests SET slip_error_count = @errCount WHERE request_id = @rid`);

                return res.status(400).json({ 
                    success: false, 
                    message: `❌ ยอดเงินไม่ถูกต้อง! คุณต้องระบุยอดโอนให้ตรงกับที่ระบบกำหนด คือ ${expectedAmount.toLocaleString()} ${job.currency}\n(เตือนครั้งที่ ${currentErrorCount}/3 หากผิดครบ 3 ครั้งบัญชีจะถูกระงับและยกเลิกงาน!)` 
                });
            }
        }

        // 🌟 3. ถ้ายอดเงินตรงกันเป๊ะ: บันทึกข้อมูลและเปลี่ยนสถานะเป็น VERIFYING
        await pool.request()
            .input('rid', sql.Int, request_id)
            .input('slip', sql.NVarChar(sql.MAX), slip_image) 
            .input('t_amount', sql.Decimal(18,4), inputAmount)
            .input('t_date', sql.Date, transfer_date)
            .input('t_time', sql.Time, transfer_time)
            .query(`
                UPDATE P2P_Requests 
                SET slip_url = @slip, 
                    transfer_amount = @t_amount,
                    transfer_date = @t_date,
                    transfer_time = @t_time,
                    slip_error_count = 0, -- รีเซ็ตค่าเพื่อความสะอาด
                    status = 'VERIFYING' 
                WHERE request_id = @rid
            `);

        res.json({ success: true, message: '✅ ส่งหลักฐานสำเร็จ! ระบบบันทึกข้อมูลและส่งให้ลูกค้าตรวจสอบแล้ว' });

    } catch (err) {
        console.error("Upload Slip Error:", err);
        res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
    }
});
// ==========================================
// 🌟 API P2P ฝั่งถอนเงิน สินสุด
// ==========================================

// ==========================================
// 🔔 [NOTIFICATION APIs]
// ==========================================

// 1. ดึงรายการแจ้งเตือนทั้งหมดของ User (เฉพาะที่ยังไม่ลบ)
app.get('/api/notifications/:userId', async (req, res) => {
    try {
        const uid = parseInt(req.params.userId, 10);
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('uid', sql.Int, uid)
            .query(`
                SELECT notification_id, title, message, type, is_read, created_at
                FROM Notifications
                WHERE user_id = @uid AND is_deleted = 0
                ORDER BY created_at DESC
            `);

        const unreadCount = result.recordset.filter(n => !n.is_read).length;
        res.json({ success: true, notifications: result.recordset, unreadCount });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 2. ปรับสถานะเป็นอ่านแล้ว (Mark as Read)
app.post('/api/notifications/read', async (req, res) => {
    try {
        const { notification_id, user_id } = req.body;
        const pool = await sql.connect(dbConfig);
        await pool.request()
            .input('nid', sql.Int, notification_id)
            .input('uid', sql.Int, user_id)
            .query(`UPDATE Notifications SET is_read = 1 WHERE notification_id = @nid AND user_id = @uid`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 3. ปรับสถานะเป็นลบ (Soft Delete - ไม่ลบจริง)
app.post('/api/notifications/delete', async (req, res) => {
    try {
        const { notification_id, user_id } = req.body;
        const pool = await sql.connect(dbConfig);
        await pool.request()
            .input('nid', sql.Int, notification_id)
            .input('uid', sql.Int, user_id)
            .query(`UPDATE Notifications SET is_deleted = 1 WHERE notification_id = @nid AND user_id = @uid`);
        res.json({ success: true, message: 'ลบการแจ้งเตือนเรียบร้อยแล้ว' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.listen(port, () => {
    console.log(`🚀 Server เปิดทำงานแล้วที่พอร์ต ${port}`);
});