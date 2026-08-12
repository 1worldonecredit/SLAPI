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
  credentials: true // อนุญาตให้ส่ง Cookie หรือ Header ยืนยันตัวตนได้
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
// 🌟 ระบบเปิด-ปิดรับซื้อ และ ออกรางวัลอัตโนมัติ (Cron Job รันทุกๆ 1 นาที)
// ==========================================
cron.schedule('* * * * *', async () => {
    try {
        const pool = await sql.connect(dbConfig);
        
        // 1. ดึงข้อมูลจาก System_Settings
        const res = await pool.request().query(`
            SELECT 
                CONVERT(varchar(5), close_time, 108) as close_time,
                CONVERT(varchar(5), open_time, 108) as open_time,
                CONVERT(varchar(5), draw_time, 108) as draw_time,
                is_auto_draw,
                auto_draw_percent
            FROM System_Settings WHERE id = 1
        `);
        
        if (res.recordset.length > 0) {
            const { close_time, open_time, draw_time, is_auto_draw, auto_draw_percent } = res.recordset[0];
            
            // 2. ดึงเวลาปัจจุบันของ Server (ล็อกเป็นเวลาไทย HH:mm)
            const currentTime = new Date().toLocaleTimeString('en-US', { 
                timeZone: 'Asia/Bangkok', 
                hour12: false, 
                hour: '2-digit', 
                minute: '2-digit' 
            });

            // 3. ถ้าถึงเวลาปิดรับซื้อ -> สั่งอัปเดตตารางปิดระบบ
            if (currentTime === close_time) {
                await pool.request().query("UPDATE System_Settings SET is_sales_open = 0 WHERE id = 1");
                console.log(`⏰ [${currentTime}] ถึงเวลาปิดรับซื้อ -> สั่งปิดระบบอัตโนมัติเรียบร้อย`);
            }
            
            // 4. ถ้าถึงเวลาเปิดรับซื้อ (รอบใหม่) -> สั่งอัปเดตตารางเปิดระบบ
            if (currentTime === open_time) {
                await pool.request().query("UPDATE System_Settings SET is_sales_open = 1 WHERE id = 1");
                console.log(`⏰ [${currentTime}] ถึงเวลาเปิดรับซื้อ -> สั่งเปิดระบบอัตโนมัติเรียบร้อย`);
            }

            // ==========================================
            // 🌟 5. ถ้าถึงเวลาออกเลข ให้ออกรางวัลอัตโนมัติ! (อัปเกรดระบบคุมกำไร)
            // ==========================================
            if (currentTime === draw_time) {
                // เช็คก่อนว่าแอดมินติ๊กปุ่ม "เปิดระบบออโต้" ไว้หรือไม่?
                if (!is_auto_draw) {
                    console.log(`⏰ [${currentTime}] ถึงเวลาออกรางวัล แต่แอดมินไม่ได้เปิดระบบออโต้ไว้ (รอแอดมินกดเอง)`);
                    return; 
                }

                console.log(`🎰 [${currentTime}] เริ่มระบบออโต้! กำลังสุ่มเลขแบบคุมกำไรเป้าหมายที่ ${auto_draw_percent}%...`);
                
                // หาวันที่ปัจจุบัน (ล็อกเป็นเวลาไทย)
                const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

                // --- 5.1 ระบบหาเลขที่ยอดจ่ายไม่เกินเป้าหมาย (จำลองจากบิลที่รอตรวจ) ---
                const rateRes = await pool.request().query("SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'");
                const exchangeRate = rateRes.recordset.length > 0 ? rateRes.recordset[0].rate : 620.0;
                
                const salesRes = await pool.request().query(`SELECT ISNULL(SUM(CASE WHEN currency_code = 'LAK' THEN total_amount / ${exchangeRate} ELSE total_amount END), 0) as totalSalesTHB FROM Lottery_Orders WHERE status = N'รอผลตรวจ'`);
                const maxPayoutTHB = (salesRes.recordset[0].totalSalesTHB || 0) * (auto_draw_percent / 100);

                const itemsRes = await pool.request().query(`
                    SELECT CAST(i.lottery_type AS VARCHAR) as lottery_type, i.selected_number, 
                    CASE WHEN o.currency_code = 'LAK' THEN i.price / ${exchangeRate} ELSE i.price END as price_thb, r.multiplier
                    FROM Lottery_Order_Items i JOIN Lottery_Orders o ON i.order_id = o.order_id
                    LEFT JOIN Lottery_Prize_Rates r ON CAST(i.lottery_type AS INT) = CAST(r.lottery_type AS INT)
                    WHERE o.status = N'รอผลตรวจ' AND i.status = N'รอผลตรวจ' AND i.lottery_type IN ('2','3','4','6')
                `);
                
                let bestNumber6 = null, bestPayout = -1;
                // สุ่ม 500 ครั้ง หาเลขที่ยอดจ่ายไม่เกินเป้า
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
                        if (isWin) currentPayout += item.price_thb * (item.multiplier || 0);
                    }
                    if (currentPayout <= maxPayoutTHB && currentPayout > bestPayout) {
                        bestPayout = currentPayout; bestNumber6 = random6;
                    }
                }
                
                // ถ้าสุ่มแล้วไม่ได้เลขตามเป้า ให้แรนด้อมเลขใหม่ทั้งหมด
                if (!bestNumber6) bestNumber6 = Math.floor(100000 + Math.random() * 900000).toString();

                const num8 = Math.floor(10000000 + Math.random() * 90000000).toString(); // เลขซูเปอร์ 8
                const num6 = bestNumber6;
                const num4 = num6.slice(-4);
                const num3 = num6.slice(-3);
                const num2 = num6.slice(-2);

                console.log(`🎯 สุ่มได้เลขที่ 1: ${num6} (ยอดจ่ายจำลอง: ${bestPayout.toFixed(2)} บาท)`);

                // --- 5.2 บันทึกผลลงตาราง Draw_Results ---
                await pool.request()
                    .input('dDate', sql.Date, today).input('p8', sql.VarChar, num8)
                    .input('p6', sql.VarChar, num6).input('p4', sql.VarChar, num4)
                    .input('p3', sql.VarChar, num3).input('p2', sql.VarChar, num2)
                    .query(`
                        IF NOT EXISTS (SELECT 1 FROM Draw_Results WHERE draw_date = @dDate)
                            INSERT INTO Draw_Results (draw_date, prize_8, prize_6, prize_4, prize_3, prize_2) 
                            VALUES (@dDate, @p8, @p6, @p4, @p3, @p2);
                    `);

                // --- 5.3 ตรวจบิลและแจกเงินเข้า Wallet ให้ผู้ชนะอัตโนมัติ ---
                // ใช้ตัวคูณ (Multiplier) จากตาราง Lottery_Prize_Rates เพื่อความถูกต้อง
                await pool.request().query(`
                    UPDATE i SET 
                        status = CASE 
                            WHEN (i.lottery_type = '2' AND i.selected_number = '${num2}') OR
                                 (i.lottery_type = '3' AND i.selected_number = '${num3}') OR
                                 (i.lottery_type = '4' AND i.selected_number = '${num4}') OR
                                 (i.lottery_type = '6' AND i.selected_number = '${num6}') OR
                                 (i.lottery_type = '8' AND i.selected_number = '${num8}') THEN N'ถูกรางวัล'
                            ELSE N'ไม่ถูกรางวัล'
                        END,
                        prize_amount = CASE
                            WHEN i.lottery_type = '2' AND i.selected_number = '${num2}' THEN i.price * (SELECT multiplier FROM Lottery_Prize_Rates WHERE lottery_type = '2')
                            WHEN i.lottery_type = '3' AND i.selected_number = '${num3}' THEN i.price * (SELECT multiplier FROM Lottery_Prize_Rates WHERE lottery_type = '3')
                            WHEN i.lottery_type = '4' AND i.selected_number = '${num4}' THEN i.price * (SELECT multiplier FROM Lottery_Prize_Rates WHERE lottery_type = '4')
                            WHEN i.lottery_type = '6' AND i.selected_number = '${num6}' THEN i.price * (SELECT multiplier FROM Lottery_Prize_Rates WHERE lottery_type = '6')
                            WHEN i.lottery_type = '8' AND i.selected_number = '${num8}' THEN i.price * (SELECT multiplier FROM Lottery_Prize_Rates WHERE lottery_type = '8')
                            ELSE 0
                        END
                    FROM Lottery_Order_Items i
                    JOIN Lottery_Orders o ON i.order_id = o.order_id
                    WHERE o.status = N'รอผลตรวจ' AND i.status = N'รอผลตรวจ';

                    -- จ่ายเงินเข้า Wallet
                    UPDATE Wallets 
                    SET balance = balance + (
                        SELECT ISNULL(SUM(prize_amount), 0) 
                        FROM Lottery_Order_Items i 
                        JOIN Lottery_Orders o ON i.order_id = o.order_id 
                        WHERE o.user_id = Wallets.user_id AND i.status = N'ถูกรางวัล' AND o.status = N'รอผลตรวจ'
                    )
                    WHERE user_id IN (
                        SELECT DISTINCT o.user_id FROM Lottery_Order_Items i 
                        JOIN Lottery_Orders o ON i.order_id = o.order_id 
                        WHERE i.status = N'ถูกรางวัล' AND o.status = N'รอผลตรวจ'
                    );

                    -- บันทึกประวัติการรับเงินรางวัลลง Transactions (หากต้องการ)
                    INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at)
                    SELECT DISTINCT o.user_id, 'Reward', N'ถูกรางวัล', 
                           SUM(i.prize_amount) OVER(PARTITION BY o.user_id), 
                           'Completed', GETDATE()
                    FROM Lottery_Order_Items i 
                    JOIN Lottery_Orders o ON i.order_id = o.order_id 
                    WHERE i.status = N'ถูกรางวัล' AND o.status = N'รอผลตรวจ';

                    -- ปิดบิลที่ตรวจแล้ว
                    UPDATE Lottery_Orders SET status = N'ตรวจผลแล้ว' WHERE status = N'รอผลตรวจ';
                `);
                
                console.log(`✅ [AUTO-DRAW] ออกรางวัลและจ่ายเงินสำเร็จเรียบร้อย!`);
            }
            // ==========================================
        }
    } catch (err) {
        console.error('❌ เกิดข้อผิดพลาดในระบบตั้งเวลาอัตโนมัติ:', err);
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
// API 2: ดึงบัญชีธนาคารของ User และเช็กข้อมูลชื่อ
// ==========================================
app.get('/api/user-profile-banks/:userId', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const userId = req.params.userId;

    // ดึงชื่อ นามสกุล
    const nameResult = await pool.request()
      .input('userId', sql.Int, userId)
      .query('SELECT firstname, lastname FROM UserName_Lastname WHERE user_id = @userId');
    
    // ดึงบัญชีธนาคาร
    const bankResult = await pool.request()
      .input('userId', sql.Int, userId)
      .query(`
        SELECT ub.*, b.bank_name, b.logo_url 
        FROM UserBanks ub 
        JOIN Banks b ON ub.bank_id = b.bank_id 
        WHERE ub.user_id = @userId
      `);

    res.json({ 
      success: true, 
      profile: nameResult.recordset[0] || null,
      userBanks: bankResult.recordset 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'ระบบขัดข้อง' });
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
// API: ทดสอบ ลบได้หลังทดสอบ
// ==========================================
app.get('/api/admin/test-db-connection', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    // ดึงผู้ใช้งานมา 1 คน (TOP 1) เพื่อพิสูจน์ว่าเชื่อม DB ได้จริง
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
// API: (Admin) ดึงข้อมูลบัญชีธนาคารของลูกค้าทั้งหมด
// ==========================================
app.get('/api/admin/customer-banks', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        ub.user_bank_id, ub.account_name, ub.account_number, ub.is_primary, ub.created_at, ub.currency_code,
        ub.status,  -- 🌟 ดึงคอลัมน์ status มาเพื่อให้หน้าเว็บแยกแท็บได้
        u.username,
        b.bank_name
      FROM UserBanks ub
      LEFT JOIN Users u ON ub.user_id = u.user_id
      LEFT JOIN Banks b ON ub.bank_id = b.bank_id
      ORDER BY ub.created_at DESC
    `);
    res.json({ success: true, banks: result.recordset });
  } catch (error) {
    console.error('Fetch Customer Banks Error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลบัญชี' });
  }
});

// ==========================================
// API: (Admin) จัดการอนุมัติ หรือ ปฏิเสธ บัญชีธนาคารลูกค้า
// ==========================================
app.post('/api/admin/verify-customer-bank', async (req, res) => {
  const { userBankId, action } = req.body; 

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
// 1. API ดึงรายการคำขอเพิ่มบัญชีธนาคารทั้งหมด
// ==========================================
app.get('/api/admin/user-banks', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        // ดึงข้อมูลธนาคาร พร้อม Join หาชื่อลูกค้า (UserName_Lastname)
        const result = await pool.request().query(`
            SELECT 
                ub.user_bank_id, ub.user_id, ub.bank_id, ub.account_name, ub.account_number, 
                ub.is_primary, ub.created_at, ub.currency_code, ub.status,
                un.firstname, un.lastname
            FROM UserBanks ub
            LEFT JOIN UserName_Lastname un ON ub.user_id = un.user_id
            ORDER BY ub.created_at DESC
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Error fetching user banks:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ==========================================
// 2. API อัปเดตสถานะ (อนุมัติ/ไม่อนุมัติ) + แจ้งเตือน + เก็บชื่อคนทำ
// ==========================================
app.put('/api/admin/user-banks/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status, user_id, admin_name, reject_reason } = req.body; 
    // status คาดหวังเป็น: 'Approved' (ผ่าน) หรือ 'Rejected' (ไม่ผ่าน)

    try {
        const pool = await sql.connect(dbConfig);
        
        // 🌟 1. อัปเดตสถานะในตาราง UserBanks
        // (หมายเหตุ: หากคุณต้องการเก็บชื่อคนตรวจลง DB แนะนำให้เพิ่มคอลัมน์ reviewed_by ในตาราง UserBanks ก่อนนะครับ)
        await pool.request()
            .input('id', sql.Int, id)
            .input('status', sql.VarChar, status)
            // .input('reviewed_by', sql.NVarChar, admin_name) // เปิดใช้บรรทัดนี้ถ้าเพิ่มคอลัมน์แล้ว
            .query(`
                UPDATE UserBanks 
                SET status = @status 
                WHERE user_bank_id = @id
            `);

        // 🌟 2. ส่ง Notification แจ้งลูกค้า
        const notifMessage = status === 'Approved' 
            ? `บัญชีธนาคาร ${reject_reason || ''} ของคุณได้รับการอนุมัติเรียบร้อยแล้ว` 
            : `คำขอเพิ่มบัญชีถูกปฏิเสธ: ${reject_reason || 'ข้อมูลไม่ถูกต้อง'}`;
            
        await pool.request()
            .input('user_id', sql.Int, user_id)
            .input('message', sql.NVarChar, notifMessage)
            .query(`
                INSERT INTO Notifications (user_id, message, is_read, created_at)
                VALUES (@user_id, @message, 0, GETDATE())
            `);

        res.json({ success: true, message: 'บันทึกข้อมูลและส่งแจ้งเตือนสำเร็จ' });
    } catch (err) {
        console.error('Error updating bank status:', err);
        res.status(500).json({ success: false, message: 'Server error' });
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
// 🌟 API 1: ดึงการตั้งค่าระบบ (รวมเวลา 3 อย่าง)
// ==========================================
app.get('/api/admin/settings', async (req, res) => {
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
        console.error(err);
        res.status(500).json({ success: false }); 
    }
});
// ==========================================
// 🌟 API: บันทึกการตั้งค่าระบบและเวลา 3 อย่าง (แก้ไขให้เซฟลง Database 100%)
// ==========================================
app.post('/api/admin/settings', async (req, res) => {
    const { close_time, open_time, draw_time, is_sales_open } = req.body;
    
    // พิมพ์ค่าที่รับมาออกหน้าจอดำๆ (Terminal) จะได้รู้ว่าส่งมาถูกไหม
    console.log("📥 ข้อมูลที่หน้าเว็บส่งมาบันทึก:", req.body); 

    try {
        const pool = await sql.connect(dbConfig);
        await pool.request()
            // 🌟 แก้ตรงนี้: เปลี่ยนจาก sql.Time เป็น sql.VarChar เพื่อตัดปัญหา Error
            .input('closeTime', sql.VarChar, close_time) 
            .input('openTime', sql.VarChar, open_time)
            .input('drawTime', sql.VarChar, draw_time)
            .input('isOpen', sql.Bit, is_sales_open)
            .query(`
                UPDATE System_Settings 
                SET 
                    close_time = CAST(@closeTime AS TIME), 
                    open_time = CAST(@openTime AS TIME), 
                    draw_time = CAST(@drawTime AS TIME), 
                    is_sales_open = @isOpen,
                    last_updated = GETDATE()
                WHERE id = 1
            `);
            
        console.log("✅ บันทึกเวลาลงฐานข้อมูลสำเร็จ!");
        res.json({ success: true, message: 'บันทึกสำเร็จ' });
    } catch (err) { 
        console.error("❌ Error ตอนบันทึก:", err);
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
// 🌟 API: ดึงประวัติผลการออกรางวัลและรายชื่อคนถูกรางวัล ย้อนหลังตามวันที่
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
                SELECT u.username, i.lottery_type, i.selected_number, i.price, i.prize_amount, o.currency_code
                FROM Lottery_Order_Items i
                JOIN Lottery_Orders o ON i.order_id = o.order_id
                JOIN Users u ON o.user_id = u.user_id
                WHERE o.draw_date = @dDate AND i.status = N'ถูกรางวัล'
            `);

        res.json({ 
            success: true, 
            results: resultRes.recordset.length > 0 ? resultRes.recordset[0] : null,
            winners: winnersRes.recordset 
        });
    } catch (err) {
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
// 🌟 API สุ่มเลขแนะนำ (AI V19: Elastic Buffer - ลดความตึงเครียดของเพดาน ยอมให้ทะลุได้ 15% เพื่อดัน % ให้ใกล้เคียงเป้าที่สุด)
// ==========================================
app.post('/api/admin/yeeki/suggest-draw', async (req, res) => {
    const { target_percent, round_id } = req.body;
    try {
        const pool = await sql.connect(dbConfig);

        const ordersReq = await pool.request()
            .input('roundId', sql.Int, round_id)
            .query(`
                SELECT i.lottery_type, i.selected_number, i.price, o.currency_code
                FROM Yeeki_Order_Items i
                JOIN Yeeki_Orders o ON i.order_id = o.order_id
                WHERE o.round_id = @roundId
            `);
        const orders = ordersReq.recordset;

        const exReq = await pool.request().query(`SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'`);
        const lakRate = exReq.recordset[0]?.rate || 620;

        const ratesReq = await pool.request().query(`SELECT lottery_type, multiplier FROM Yeeki_Prize_Rates`);
        const prizeRates = {};
        ratesReq.recordset.forEach(r => prizeRates[r.lottery_type] = r.multiplier);

        let totalSalesTHB = 0;
        let hasBets = false;

        // จัดกลุ่มบิลทั้งหมดเพื่อการค้นหาอย่างรวดเร็ว
        let bets = { t6: {}, t4: {}, t3: {}, tTode: {}, t2: {}, tRun: {}, b2: {}, bRun: {}, s8: {} };

        orders.forEach(o => {
            hasBets = true;
            let thbPrice = (o.currency_code === 'LAK' || o.currency_code === '₭') ? (o.price / lakRate) : o.price;
            totalSalesTHB += thbPrice;
            
            let payoutTHB = thbPrice * (prizeRates[o.lottery_type] || 0);
            let isLAK = (o.currency_code === 'LAK' || o.currency_code === '₭');
            let n = o.selected_number;
            let t = o.lottery_type;

            const addBet = (obj, key) => {
                if (!obj[key]) obj[key] = { p: 0, thb: 0, lak: 0 };
                obj[key].p += payoutTHB;
                if (isLAK) obj[key].lak += payoutTHB; else obj[key].thb += payoutTHB;
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

        // 🎯 เป้าหมายหลัก
        const targetPayoutTHB = totalSalesTHB * (target_percent / 100);
        // 🔥 ปลดเงื่อนไขให้อ่อนลง: อนุญาตให้ทะลุเป้าหมายได้สูงสุด 15% (Buffer 1.15)
        const maxAllowedPayoutTHB = targetPayoutTHB * 1.15; 
        
        const pad = (num, len) => num.toString().padStart(len, '0');

        // ==========================================
        // 🌟 ด่านที่ 1: กรองเลขบน (6 -> 4 -> 3) ภายใต้เงื่อนไขที่อ่อนลง
        // ==========================================
        let t4_pool = new Set();
        Object.keys(bets.t4).forEach(k => t4_pool.add(k));
        Object.keys(bets.t3).forEach(k => { for(let i=0; i<=9; i++) t4_pool.add(i.toString() + k); });
        Object.keys(bets.t2).forEach(k => { for(let i=0; i<=99; i++) t4_pool.add(pad(i,2) + k); });

        if (t4_pool.size === 0) t4_pool.add(pad(Math.floor(Math.random() * 10000), 4));

        let validTops = [];
        for (let t4 of t4_pool) {
            for (let i = 0; i <= 99; i++) {
                let sim6 = pad(i, 2) + t4;
                let n4 = sim6.slice(-4), n3 = sim6.slice(-3), n2 = sim6.slice(-2);
                let sT3 = n3.split('').sort().join('');

                let p = 0, thb = 0, lak = 0;
                let has3Top = false;

                if (bets.t6[sim6]) { p += bets.t6[sim6].p; thb += bets.t6[sim6].thb; lak += bets.t6[sim6].lak; }
                if (bets.t4[n4]) { p += bets.t4[n4].p; thb += bets.t4[n4].thb; lak += bets.t4[n4].lak; }
                if (bets.t3[n3]) { p += bets.t3[n3].p; thb += bets.t3[n3].thb; lak += bets.t3[n3].lak; has3Top = true; }
                if (bets.tTode[sT3]) { p += bets.tTode[sT3].p; thb += bets.tTode[sT3].thb; lak += bets.tTode[sT3].lak; has3Top = true; }
                if (bets.t2[n2]) { p += bets.t2[n2].p; thb += bets.t2[n2].thb; lak += bets.t2[n2].lak; }
                
                let rSet = new Set(n3.split(''));
                rSet.forEach(r => {
                    if (bets.tRun[r]) { p += bets.tRun[r].p; thb += bets.tRun[r].thb; lak += bets.tRun[r].lak; }
                });

                // ใช้เพดานใหม่ที่ยืดหยุ่นขึ้น (maxAllowedPayoutTHB)
                if (p <= maxAllowedPayoutTHB) {
                    validTops.push({ sim6, p, thb, lak, has3Top, n4 });
                }
            }
        }

        // ==========================================
        // 🌟 ด่านที่ 2: เตรียมเลขล่าง (2)
        // ==========================================
        let validBots = [];
        for (let i = 0; i <= 99; i++) {
            let sim2 = pad(i, 2);
            let p = 0, thb = 0, lak = 0;

            if (bets.b2[sim2]) { p += bets.b2[sim2].p; thb += bets.b2[sim2].thb; lak += bets.b2[sim2].lak; }
            let rSet = new Set(sim2.split(''));
            rSet.forEach(r => {
                if (bets.bRun[r]) { p += bets.bRun[r].p; thb += bets.bRun[r].thb; lak += bets.bRun[r].lak; }
            });

            if (p <= maxAllowedPayoutTHB) {
                validBots.push({ sim2, p, thb, lak });
            }
        }

        if (validTops.length === 0) validTops.push({ sim6: pad(Math.floor(Math.random() * 1000000), 6), p: 0, thb: 0, lak: 0, has3Top: false, n4: '0000' });
        if (validBots.length === 0) validBots.push({ sim2: pad(Math.floor(Math.random() * 100), 2), p: 0, thb: 0, lak: 0 });

        // ==========================================
        // 🌟 ด่านที่ 3: จับคู่เพื่อหาความใกล้เคียงที่สุด (Absolute Closeness)
        // ==========================================
        let bestMatch = null;
        let minDiff = Infinity; 

        for (let top of validTops) {
            for (let bot of validBots) {
                let totalPayout = top.p + bot.p;
                
                // ถ้ายอดรวม บน+ล่าง อยู่ในบัฟเฟอร์ 115%
                if (totalPayout <= maxAllowedPayoutTHB && totalPayout > 0) {
                    // 🔥 หาระยะห่างแบบสัมบูรณ์ (ไม่ว่าขาดหรือเกิน ยึดตัวที่ใกล้ 100% ที่สุด)
                    let diff = Math.abs(totalPayout - targetPayoutTHB); 

                    if (diff < minDiff) {
                        minDiff = diff;
                        bestMatch = { top, bot, totalPayout };
                    } 
                    else if (diff === minDiff && bestMatch) {
                        // ถ้าระยะห่างเท่ากัน (สูสีกัน) ให้ให้สิทธิ์ชุดที่มี 3 ตัวก่อน
                        if (top.has3Top && !bestMatch.top.has3Top) {
                            bestMatch = { top, bot, totalPayout };
                        } else if (top.has3Top === bestMatch.top.has3Top) {
                            // ถ้ามี 3 ตัวทั้งคู่ ดูความสมดุลของเงินบาทและกีบ
                            let curBal = Math.abs(top.thb + bot.thb - (top.lak + bot.lak));
                            let bestBal = Math.abs(bestMatch.top.thb + bestMatch.bot.thb - (bestMatch.top.lak + bestMatch.bot.lak));
                            if (curBal < bestBal) {
                                bestMatch = { top, bot, totalPayout };
                            }
                        }
                    }
                }
            }
        }

        // กรณีฉุกเฉิน
        if (!bestMatch) {
            let absMinPayout = Infinity;
            for (let top of validTops) {
                for (let bot of validBots) {
                    let total = top.p + bot.p;
                    if (total < absMinPayout) {
                        absMinPayout = total;
                        bestMatch = { top, bot, totalPayout: total };
                    }
                }
            }
        }

        // ==========================================
        // 🌟 ด่านที่ 4: เติม 2 ตัวหน้าให้ครบ 8 ตัว
        // ==========================================
        let final6 = bestMatch.top.sim6;
        let final8 = '00' + final6;
        let min8Diff = Infinity;

        for (let i = 0; i <= 99; i++) {
            let sim8 = pad(i, 2) + final6;
            let extraPayout = bets.s8[sim8] ? bets.s8[sim8].p : 0;
            let newTotal = bestMatch.totalPayout + extraPayout;
            
            if (newTotal <= maxAllowedPayoutTHB) {
                let diff = Math.abs(newTotal - targetPayoutTHB);
                if (diff < min8Diff) {
                    min8Diff = diff;
                    final8 = sim8;
                }
            }
        }

        res.json({
            success: true,
            suggestedSuper: final8,
            suggested6: final6,
            suggestedTop: bestMatch.top.sim6.slice(-4),
            suggestedBottom: bestMatch.bot.sim2
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
    const { round_id, super_number, top_6, bottom_2 } = req.body;
    let pool;
    try {
        pool = await sql.connect(dbConfig);
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const top_4 = top_6.slice(-4);
            const top_3 = top_6.slice(-3);
            const top_2 = top_6.slice(-2);

            await transaction.request()
                .input('roundId', sql.Int, round_id)
                .input('res8', sql.VarChar(8), super_number)
                .input('res4', sql.VarChar(4), top_4) 
                .input('res3', sql.VarChar(3), top_3)
                .input('res2bot', sql.VarChar(2), bottom_2)
                .query(`
                    UPDATE Yeeki_Rounds 
                    SET result_8_super = @res8, result_4_top = @res4, result_3_top = @res3, result_2_bottom = @res2bot, status = 'Completed' 
                    WHERE round_id = @roundId
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
            
            // 🌟 แก้ไข: ดึง item_id มาด้วย เพื่อป้องกันบั๊กอัปเดตบิลผิดตัว
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
                            case '4 ตัวท้าย': if (num === t4) isWin = true; break;
                            case '3 ตัวบน': if (num === t3) isWin = true; break;
                            case '3 ตัวโต๊ด': if (num.split('').sort().join('') === sT3) isWin = true; break; // แก้บั๊ก 3 ตัวโต๊ด
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
                let top3 = top_number.slice(-3); let top2 = top_number.slice(-2);

                await transaction.request().input('rid', sql.Int, round.round_id).input('s8', sql.VarChar, super_number).input('t4', sql.VarChar, top_number).input('t3', sql.VarChar, top3).input('b2', sql.VarChar, bottom_number)
                    .query(`UPDATE Yeeki_Rounds SET result_8_super = @s8, result_4_top = @t4, result_3_top = @t3, result_2_bottom = @b2, status = 'Completed' WHERE round_id = @rid`);

                for (let item of items) {
                    let isWin = false; let num = item.selected_number;
                    switch (item.lottery_type) {
                        case '8 ตัว (Super)': if (num === super_number) isWin = true; break;
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
                        
                        // 🌟 แก้ไขให้ใช้ item_id ป้องกันการอัปเดตผิดบิล
                        await transaction.request().input('itemId', sql.Int, item.item_id).input('prize', sql.Decimal(18,2), prize)
                            .query(`UPDATE Yeeki_Order_Items SET status = 'Win', prize_amount = @prize WHERE item_id = @itemId`);
                        
                        await transaction.request().input('uid', sql.Int, item.user_id).input('prizeAmount', sql.Decimal(18,2), prize)
                            .query(`UPDATE Users SET wallet_balance = wallet_balance + @prizeAmount WHERE user_id = @uid`);
                            
                        // 🌟🌟🌟 ไฮไลท์สำคัญ: เพิ่มระบบบันทึกประวัติให้หุ่นยนต์ 🌟🌟🌟
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


/// ==========================================
// 🌟 API: ยืนยันผลรางวัลด้วยมือ (Manual Execute Draw)
// กดปุ่มเดียวตรวจบิล เปลี่ยนสถานะ โอนเงินรางวัลให้ผู้ชนะ และ จ่ายค่าคอมให้ผู้แนะนำ ทันที!
// ==========================================
app.post('/api/admin/execute-draw', async (req, res) => {
    const { number6 } = req.body;
    try {
        const pool = await sql.connect(dbConfig);
        
        const num8 = Math.floor(10000000 + Math.random() * 90000000).toString(); // สุ่มเลข 8 ตัว
        const num6 = number6;
        const num4 = num6.slice(-4);
        const num3 = num6.slice(-3);
        const num2 = num6.slice(-2);
        
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

        // 1. บันทึกผลรางวัลลง Draw_Results
        await pool.request()
            .input('dDate', sql.Date, today).input('p8', sql.VarChar, num8)
            .input('p6', sql.VarChar, num6).input('p4', sql.VarChar, num4)
            .input('p3', sql.VarChar, num3).input('p2', sql.VarChar, num2)
            .query(`
                IF NOT EXISTS (SELECT 1 FROM Draw_Results WHERE draw_date = @dDate)
                    INSERT INTO Draw_Results (draw_date, prize_8, prize_6, prize_4, prize_3, prize_2) 
                    VALUES (@dDate, @p8, @p6, @p4, @p3, @p2);
                ELSE
                    UPDATE Draw_Results 
                    SET prize_8 = @p8, prize_6 = @p6, prize_4 = @p4, prize_3 = @p3, prize_2 = @p2 
                    WHERE draw_date = @dDate;
            `);

        // 2. ตรวจบิล, อัปเดตยอดเงิน, จ่ายเข้า Wallets, จ่ายค่าคอมผู้แนะนำ, บันทึกประวัติ
        await pool.request().query(`
            -- 2.1 อัปเดตสถานะบิลและคำนวณเงินรางวัลที่จะได้
            UPDATE i SET 
                status = CASE 
                    WHEN (i.lottery_type = '2' AND i.selected_number = '${num2}') OR
                         (i.lottery_type = '3' AND i.selected_number = '${num3}') OR
                         (i.lottery_type = '4' AND i.selected_number = '${num4}') OR
                         (i.lottery_type = '6' AND i.selected_number = '${num6}') OR
                         (i.lottery_type = '8' AND i.selected_number = '${num8}') THEN N'ถูกรางวัล'
                    ELSE N'ไม่ถูกรางวัล'
                END,
                prize_amount = CASE
                    WHEN i.lottery_type = '2' AND i.selected_number = '${num2}' THEN i.price * (SELECT multiplier FROM Lottery_Prize_Rates WHERE lottery_type = '2')
                    WHEN i.lottery_type = '3' AND i.selected_number = '${num3}' THEN i.price * (SELECT multiplier FROM Lottery_Prize_Rates WHERE lottery_type = '3')
                    WHEN i.lottery_type = '4' AND i.selected_number = '${num4}' THEN i.price * (SELECT multiplier FROM Lottery_Prize_Rates WHERE lottery_type = '4')
                    WHEN i.lottery_type = '6' AND i.selected_number = '${num6}' THEN i.price * (SELECT multiplier FROM Lottery_Prize_Rates WHERE lottery_type = '6')
                    WHEN i.lottery_type = '8' AND i.selected_number = '${num8}' THEN i.price * (SELECT multiplier FROM Lottery_Prize_Rates WHERE lottery_type = '8')
                    ELSE 0
                END
            FROM Lottery_Order_Items i
            JOIN Lottery_Orders o ON i.order_id = o.order_id
            WHERE o.status = N'รอผลตรวจ' AND i.status = N'รอผลตรวจ';

            -- 2.2 โอนเงินรางวัลเข้า Wallet ของผู้ชนะ
            UPDATE Wallets 
            SET balance = ISNULL(balance, 0) + (
                SELECT ISNULL(SUM(prize_amount), 0) 
                FROM Lottery_Order_Items i 
                JOIN Lottery_Orders o ON i.order_id = o.order_id 
                WHERE o.user_id = Wallets.user_id AND i.status = N'ถูกรางวัล' AND o.status = N'รอผลตรวจ'
            )
            WHERE user_id IN (
                SELECT DISTINCT o.user_id FROM Lottery_Order_Items i 
                JOIN Lottery_Orders o ON i.order_id = o.order_id 
                WHERE i.status = N'ถูกรางวัล' AND o.status = N'รอผลตรวจ'
            );

            -- 2.3 บันทึกประวัติการรับเงินลงในตาราง Transactions (Statement ของผู้ชนะ)
            INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at)
            SELECT DISTINCT o.user_id, 'Reward', N'เงินรางวัลหวย', 
                   SUM(i.prize_amount) OVER(PARTITION BY o.user_id), 
                   'Completed', GETDATE()
            FROM Lottery_Order_Items i 
            JOIN Lottery_Orders o ON i.order_id = o.order_id 
            WHERE i.status = N'ถูกรางวัล' AND o.status = N'รอผลตรวจ';

            -- ==========================================
            -- 🌟 2.4 ระบบแจกค่าคอมมิชชั่นจากการ "ลูกทีมถูกรางวัล" (ให้ผู้แนะนำ)
            -- ==========================================
            DECLARE @WinPercent DECIMAL(18,2) = (SELECT TOP 1 win_percent FROM Commission_Settings);

            UPDATE w
            SET w.balance = ISNULL(w.balance, 0) + t.comm_amount
            FROM Wallets w
            JOIN (
                SELECT 
                    u.user_id as referrer_id, 
                    SUM(i.prize_amount) * (@WinPercent / 100.0) as comm_amount
                FROM Lottery_Order_Items i 
                JOIN Lottery_Orders o ON i.order_id = o.order_id 
                JOIN Users d ON o.user_id = d.user_id
                JOIN Users u ON d.referrer_username = u.username
                WHERE i.status = N'ถูกรางวัล' AND o.status = N'รอผลตรวจ'
                GROUP BY u.user_id
                HAVING SUM(i.prize_amount) > 0
            ) t ON w.user_id = t.referrer_id;

            -- 🌟 แสตมป์ชื่อลูกทีม (+ d.username +) ลงไปในประวัติด้วย
            INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at)
            SELECT 
                u.user_id, 'Commission', N'ค่าคอมฯ ลูกทีมถูกรางวัล (' + d.username + ')', 
                SUM(i.prize_amount) * (@WinPercent / 100.0), 'Completed', GETDATE()
            FROM Lottery_Order_Items i 
            JOIN Lottery_Orders o ON i.order_id = o.order_id 
            JOIN Users d ON o.user_id = d.user_id
            JOIN Users u ON d.referrer_username = u.username
            WHERE i.status = N'ถูกรางวัล' AND o.status = N'รอผลตรวจ'
            GROUP BY u.user_id, d.username
            HAVING SUM(i.prize_amount) > 0;
            -- ==========================================

            -- 2.5 เปลี่ยนสถานะบิลใหญ่เป็น "ตรวจผลแล้ว" ปิดยอดงวดนี้
            UPDATE Lottery_Orders SET status = N'ตรวจผลแล้ว' WHERE status = N'รอผลตรวจ';
        `);

        res.json({ success: true, message: `✅ ออกรางวัลด้วยเลข ${num6} สำเร็จ! \n💰 จ่ายเงินให้ผู้ชนะ และผู้แนะนำเรียบร้อยแล้ว!` });
    } catch (err) { 
        console.error(err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการจ่ายเงิน' }); 
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
                ORDER BY round_number ASC
            `);
        
        res.json({ success: true, rounds: result.recordset });
    } catch (err) {
        console.error("Error admin fetch rounds:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 3. อัปเดตตารางรอบ 24 รอบรวดเดียว (POST Bulk) - แก้ไข poolPromise แล้ว!
// ==========================================
app.post('/api/admin/yeeki-rounds/bulk', async (req, res) => {
    try {
        const { date, rounds } = req.body;
        
        // 🌟 เปลี่ยนจาก await poolPromise มาใช้ sql.connect(dbConfig) ที่ถูกต้อง
        const pool = await sql.connect(dbConfig); 
        
        for (const round of rounds) {
            const openTime = `${date} ${round.open_time}:00`;
            const closeTime = `${date} ${round.close_time}:00`;
            const drawTime = `${date} ${round.draw_time}:00`;

            const check = await pool.request()
                .input('draw_date_str', sql.VarChar, date)
                .input('round_number', sql.Int, round.round_number)
                .query(`SELECT round_id FROM Yeeki_Rounds WHERE CAST(draw_date AS DATE) = CAST(@draw_date_str AS DATE) AND round_number = @round_number`);
            
            if (check.recordset.length > 0) {
                // มีแล้ว -> Update
                await pool.request()
                    .input('id', sql.Int, check.recordset[0].round_id)
                    .input('open', sql.DateTime, openTime)
                    .input('close', sql.DateTime, closeTime)
                    .input('draw', sql.DateTime, drawTime)
                    .query(`UPDATE Yeeki_Rounds SET open_time = @open, close_time = @close, draw_time = @draw WHERE round_id = @id`);
            } else {
                // ยังไม่มี -> Insert
                await pool.request()
                    .input('date_str', sql.VarChar, date)
                    .input('num', sql.Int, round.round_number)
                    .input('open', sql.DateTime, openTime)
                    .input('close', sql.DateTime, closeTime)
                    .input('draw', sql.DateTime, drawTime)
                    .input('status', sql.VarChar, 'Pending')
                    .query(`INSERT INTO Yeeki_Rounds (draw_date, round_number, open_time, close_time, draw_time, status) 
                            VALUES (CAST(@date_str AS DATE), @num, @open, @close, @draw, @status)`);
            }
        }
        res.json({ success: true, message: "บันทึกข้อมูลตารางเวลาสำเร็จ!" });
    } catch (err) {
        console.error("Error bulk save:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 4. อัปเดตทีละแถว จากการกดปุ่มแก้ไข (PUT) - แก้ไข poolPromise แล้ว!
// ==========================================
app.put('/api/admin/yeeki-rounds/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { draw_date, open_time, close_time, draw_time } = req.body;
        
        const openTime = `${draw_date} ${open_time}:00`;
        const closeTime = `${draw_date} ${close_time}:00`;
        const drawTime = `${draw_date} ${draw_time}:00`;

        // 🌟 เปลี่ยนจาก await poolPromise
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
// 🌟 API ฝั่งลูกค้า: ดึง 12 รอบที่กำลังจะมาถึงเสมอ (ข้ามวันอัตโนมัติ)
// ==========================================
app.get('/api/yeeki/rounds', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        
        // ใช้คำสั่ง SELECT TOP 12 และเรียงตามเวลา เพื่อให้ได้ 12 รอบถัดไปเป๊ะๆ
        const result = await pool.request().query(`
            SELECT TOP 12 * 
            FROM Yeeki_Rounds 
            WHERE draw_time >= DATEADD(hour, 7, GETUTCDATE()) 
            ORDER BY draw_date ASC, round_number ASC
        `);

        // ตรวจสอบสถานะว่าเปิดหรือปิดรับแทง
        const jsNow = new Date();
        const activeRounds = result.recordset.map(r => {
            let computedStatus = 'Pending';
            const openTime = new Date(r.open_time);
            const closeTime = new Date(r.close_time);
            
            if (jsNow >= openTime && jsNow <= closeTime) {
                computedStatus = 'Open';
            } else if (jsNow > closeTime) {
                computedStatus = 'Closed';
            }
            
            return { ...r, status: computedStatus };
        });

        res.json({ success: true, rounds: activeRounds });
    } catch (err) {
        console.error("Error fetching yeeki rounds:", err);
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

app.listen(port, () => {
    console.log(`🚀 Server เปิดทำงานแล้วที่พอร์ต ${port}`);
});