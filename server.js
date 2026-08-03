require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const cron = require('node-cron');

const app = express();
const port = process.env.PORT || 5000;

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
// 1. API สำหรับ Login (อัปเดตดึงข้อมูลครบถ้วน)
// ==========================================
app.post('/api/login', async (req, res) => {
  // รับข้อมูล username และ password ที่ Frontend ส่งมา
  const { username, password } = req.body;

  try {
    // เชื่อมต่อฐานข้อมูล
    const pool = await sql.connect(dbConfig);
    
    // 🌟 ดึงข้อมูล User พร้อมกับ Role, Level, ชื่อ-นามสกุล, ประเทศ และ สกุลเงิน
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
      return res.status(401).json({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    // 🌟 ส่งข้อมูลกลับไปให้ Frontend แบบจัดเต็ม (ชื่อ key ต้องตรงกับที่ Dashboard ใช้)
    res.json({
      success: true, // 🌟 เพิ่ม success: true เผื่อให้ Frontend เช็กง่ายขึ้น
      message: 'เข้าสู่ระบบสำเร็จ',
      user: {
        id: user.user_id, // Frontend บางจุดใช้ id
        user_id: user.user_id, // Frontend บางจุดใช้ user_id
        username: user.username,
        firstname: user.firstname || 'ผู้ใช้',
        lastname: user.lastname || '',
        country: user.country || 'Thailand',           // 🌟 ส่งประเทศกลับไป
        currency_code: user.currency_code || 'THB',    // 🌟 ส่งสกุลเงินกลับไป
        role_id: user.role_id,
        role_name: user.role_name || 'User',           // 🌟 ส่ง Role กลับไป
        level_id: user.level_id,
        level_name: user.level_name || 'ลูกค้าใหม่',       // 🌟 ส่ง Level กลับไป
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
// 🌟 API: สำหรับการซื้อหวย (และตัดเงิน/คำนวณวันอัตโนมัติ)
// ==========================================
app.post('/api/lottery/buy', async (req, res) => {
    // 🌟 เอาแค่ user_id, cart, total_price, currency มาก็พอครับ
    const { user_id, cart, total_price, currency } = req.body;
    const pool = await sql.connect(dbConfig);
    
    // 0. เช็คสถานะการขาย
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
        // 🌟 6. สร้างบิล (คำนวณวันซื้อโดยให้ SQL ทำงานเอง ไม่ต้องโยนเวลาเข้ามา)
        // ==========================================
        const orderRes = await request
            .input('currency', sql.VarChar, currency)
            .input('totalPrice', sql.Decimal(18,2), deductAmount)
            .query(`
                DECLARE @TargetDrawDate DATE;
                
                -- ดึงเวลาประเทศไทย (UTC+7)
                DECLARE @ThaiTime DATETIME = DATEADD(HOUR, 7, GETUTCDATE());
                DECLARE @CurrentTime TIME = CAST(@ThaiTime AS TIME);
                DECLARE @CurrentDate DATE = CAST(@ThaiTime AS DATE);
                
                -- ดึงเวลาปิดจาก Database โดยตรง
                DECLARE @DB_CloseTime TIME = (SELECT TOP 1 close_time FROM System_Settings);
                
                -- ถ้าซื้อหลังเวลาปิดรับ ให้ถือว่าเป็นบิลของวันพรุ่งนี้
                IF @CurrentTime >= @DB_CloseTime
                    SET @TargetDrawDate = DATEADD(day, 1, @CurrentDate);
                ELSE
                    SET @TargetDrawDate = @CurrentDate;

                INSERT INTO Lottery_Orders (user_id, total_amount, currency_code, status, draw_date, created_at)
                OUTPUT INSERTED.order_id
                VALUES (@userId, @totalPrice, @currency, N'รอผลตรวจ', @TargetDrawDate, @ThaiTime)
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
        // 🌟 7. ระบบจ่ายค่าแนะนำ ทันทีที่ทีมงานซื้อ (ดึง % จาก Database)
        // ==========================================
        const refReq = new sql.Request(transaction);
        refReq.input('buyerId', sql.Int, user_id);
        
        const referrerRes = await refReq.query(`
            SELECT u_referrer.user_id 
            FROM Users u_buyer
            JOIN Users u_referrer ON u_buyer.referrer_username = u_referrer.username
            WHERE u_buyer.user_id = @buyerId
        `);

        if (referrerRes.recordset.length > 0) {
            const referrerId = referrerRes.recordset[0].user_id;
            
            const settingReq = new sql.Request(transaction);
            const settingRes = await settingReq.query("SELECT purchase_percent FROM Commission_Settings WHERE id = 1");
            const purchasePercent = settingRes.recordset.length > 0 ? settingRes.recordset[0].purchase_percent : 2.00; 
            
            const purchaseCommission = deductAmount * (purchasePercent / 100); 

            const commReq = new sql.Request(transaction);
            commReq.input('referrerId', sql.Int, referrerId);
            commReq.input('commission', sql.Decimal(18,2), purchaseCommission);
            commReq.input('transTitle', sql.NVarChar, `รายได้ ${purchasePercent}% จากการซื้อของทีมงาน`); 
            
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
// API 1: ลูกค้าแจ้งฝากเงิน (บันทึกเป็น Pending เสมอ ต้องรอคนตรวจสลิป)
// ==========================================
app.post('/api/deposit-submit', async (req, res) => {
  try {
    const { userId, bankName, accountNumber, currencyCode, amount, depositDate, depositTime, slipBase64 } = req.body;
    const cleanAmount = Math.round(parseFloat(amount) * 100) / 100; 
    const depositDatetime = `${depositDate} ${depositTime}`;
    const pool = await sql.connect(dbConfig); 

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

    // 🌟 เอาโค้ดเช็กเติมเงินอัตโนมัติออกทั้งหมด เพื่อบังคับให้แอดมินตรวจมือ
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
// API: แอดมินตีกลับคำขอฝากเงิน (Reject & Anti-Spam Check)
// ==========================================
app.post('/api/admin/deposit-reject', async (req, res) => {
  try {
    const { depositId, userId, rejectReasons } = req.body;
    const pool = await sql.connect(dbConfig);

    // แปลง Object เหตุผลที่ติ๊กเลือก เป็น JSON String เพื่อบันทึกลงฐานข้อมูล
    const reasonsJson = JSON.stringify(rejectReasons);

    // 1. อัปเดตสถานะเป็น ตีกลับ (Rejected), บันทึกเหตุผล, และบวก edit_count เพิ่มทีละ 1
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

    // ==========================================
    // 🛡️ ระบบตรวจจับการก่อกวน (Anti-Spam / Fraud Detection)
    // ==========================================
    let isSpammer = false;
    let spamReason = '';

    // กฎข้อที่ 1: รายการเดียว แต่ส่งแก้ผิดซ้ำซากเกิน 3 ครั้ง
    if (currentEditCount > 3) {
      isSpammer = true;
      spamReason = `แก้ไขคำขอเดิมผิดพลาดเกิน 3 ครั้ง (Deposit ID: ${depositId})`;
    }

    // กฎข้อที่ 2: สแปมส่งคำขอฝากเงิน (แต่ไม่เคยจับคู่ผ่านเลย) เกิน 10 รายการในวันนี้
    if (!isSpammer) {
      const checkDailySpam = await pool.request()
        .input('userId', sql.Int, userId)
        .query(`
          SELECT COUNT(*) as pending_count FROM Transactions_Deposit 
          WHERE user_id = @userId 
            AND status IN ('Pending', 'Rejected') 
            AND CAST(created_at AS DATE) = CAST(GETDATE() AS DATE)
        `);
        
      if (checkDailySpam.recordset[0].pending_count >= 10) {
        isSpammer = true;
        spamReason = 'ส่งคำขอฝากเงินที่ไม่สำเร็จ/ตีกลับ เกิน 10 รายการใน 1 วัน';
      }
    }

    // หากเข้าข่ายก่อกวน ให้ขึ้น Blacklist แจ้งเตือนแอดมินทันที!
    if (isSpammer) {
      await pool.request()
        .input('userId', sql.Int, userId)
        .input('reason', sql.NVarChar, spamReason)
        .query(`
          UPDATE Users 
          SET is_suspicious = 1, suspicious_reason = @reason 
          WHERE user_id = @userId
        `);
        
      return res.json({ 
        success: true, 
        message: 'ส่งกลับให้ลูกค้าแก้ไขแล้ว! ⚠️ แจ้งเตือน: ระบบตรวจพบพฤติกรรมก่อกวนจากลูกค้ารายนี้ และได้ทำเครื่องหมายเฝ้าระวังแล้ว',
        isSuspicious: true
      });
    }

    res.json({ success: true, message: 'ส่งกลับให้ลูกค้าแก้ไขเรียบร้อยแล้ว' });

  } catch (error) {
    console.error('Error rejecting deposit:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการตีกลับรายการ' });
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
// API 2: บัญชีคีย์ยอดโอนเข้า (กุญแจดอกที่ 2) - จะไม่จ่ายเงินจนกว่าแอดมินจะตรวจรูปสลิป
// ==========================================
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

    // 1. บันทึกยอดที่บัญชีคีย์ลงระบบ (is_reconciled = 0 คือรอกระทบยอด)
    const insertStmt = await pool.request()
      .input('bankId', sql.Int, bankId).input('bankName', sql.NVarChar, bankName).input('accountNumber', sql.VarChar, accountNumber)
      .input('amount', sql.Decimal(18,2), cleanAmount).input('transferDate', sql.VarChar, transferDate).input('transferTime', sql.VarChar, cleanTime).input('recordedBy', sql.NVarChar, adminName)
      .query(`
        INSERT INTO Bank_Statements (bank_id, bank_name, account_number, amount, transfer_date, transfer_time, recorded_by, is_reconciled)
        OUTPUT INSERTED.statement_id
        VALUES (@bankId, @bankName, @accountNumber, @amount, CAST(@transferDate AS DATE), CAST(@transferTime AS TIME(0)), @recordedBy, 0)
      `);
    const statementId = insertStmt.recordset[0].statement_id;

    // 2. 🌟 ค้นหา "กุญแจดอกที่ 1" (ค้นหาว่ามีสลิปที่แอดมินเพิ่งกดตรวจผ่าน 'Slip Verified' รออยู่ไหม?)
    const findSlip = await pool.request()
      .input('amount', sql.Decimal(18,2), cleanAmount).input('accountNumber', sql.VarChar, accountNumber).input('transferDate', sql.VarChar, transferDate).input('transferTime', sql.VarChar, cleanTime)
      .query(`
        SELECT TOP 1 deposit_id, user_id FROM Transactions_Deposit 
        WHERE status = 'Slip Verified'
          AND account_number = @accountNumber AND ABS(amount - @amount) <= 0.01
          AND CAST(deposit_datetime AS DATE) = CAST(@transferDate AS DATE)
          AND CAST(deposit_datetime AS TIME(0)) = CAST(@transferTime AS TIME(0))
      `);

    if (findSlip.recordset.length > 0) {
      // 🟢 กรณีที่ 1: แอดมินเคยกดตรวจสลิปไว้แล้ว + บัญชีเพิ่งมาคีย์ยอด (กุญแจ 2 ดอกตรงกัน!) -> จ่ายเงินได้!
      const match = findSlip.recordset[0];

      await pool.request().input('depositId', sql.Int, match.deposit_id)
        .query("UPDATE Transactions_Deposit SET status = 'Approved', reviewed_by = 'Bank (Matched)' WHERE deposit_id = @depositId");
      
      await pool.request().input('userId', sql.Int, match.user_id).input('amount', sql.Decimal(18,2), cleanAmount)
        .query("UPDATE Wallets SET balance = ISNULL(balance, 0) + @amount, last_updated = GETDATE() WHERE user_id = @userId");

      await pool.request().input('userId', sql.Int, match.user_id).input('amount', sql.Decimal(18,2), cleanAmount).input('title', sql.NVarChar(255), 'ฝากเงิน (สำเร็จ)')
        .query("INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at) VALUES (@userId, 'Deposit', @title, @amount, 'Completed', GETDATE())");

      await pool.request().input('stmtId', sql.Int, statementId).input('depositId', sql.Int, match.deposit_id)
        .query("UPDATE Bank_Statements SET is_reconciled = 1, reconciled_with_deposit_id = @depositId WHERE statement_id = @stmtId");

      return res.json({ success: true, message: 'คีย์ยอดสำเร็จ และระบบจับคู่กับสลิปที่แอดมินตรวจไว้แล้ว! (เติมเงินเข้า Wallet แล้ว)' });
    }

    // 🟡 กรณีที่ 2: บัญชีคีย์ยอดอย่างเดียว (แอดมินยังไม่กดตรวจสลิป หรือสลิปปลอม) -> ห้ามจ่ายเงิน! 
    res.json({ success: true, message: 'บันทึกยอดเงินเข้าธนาคารสำเร็จ (รอแอดมินตรวจรูปสลิปให้ตรงกัน ระบบถึงจะจ่ายเงิน)' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: 'ระบบขัดข้อง: ' + error.message });
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
// API 2: บัญชีคีย์ยอดโอนเข้า (ค้นหาบิลที่แอดมินตรวจไว้แล้ว)
// ==========================================
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
        INSERT INTO Bank_Statements (bank_id, bank_name, account_number, amount, transfer_date, transfer_time, recorded_by, is_reconciled)
        OUTPUT INSERTED.statement_id
        VALUES (@bankId, @bankName, @accountNumber, @amount, CAST(@transferDate AS DATE), CAST(@transferTime AS TIME(0)), @recordedBy, 0)
      `);
    const statementId = insertStmt.recordset[0].statement_id;

    // 🌟 แก้ไขตรงนี้: ค้นหาสลิปที่มีสถานะ Pending และถูกแอดมินตรวจสลิปไว้แล้ว
    const findSlip = await pool.request()
      .input('amount', sql.Decimal(18,2), cleanAmount).input('accountNumber', sql.VarChar, accountNumber).input('transferDate', sql.VarChar, transferDate).input('transferTime', sql.VarChar, cleanTime)
      .query(`
        SELECT TOP 1 deposit_id, user_id FROM Transactions_Deposit 
        WHERE status = 'Pending' AND reviewed_by = 'Slip Verified'
          AND account_number = @accountNumber AND ABS(amount - @amount) <= 0.01
          AND CAST(deposit_datetime AS DATE) = CAST(@transferDate AS DATE)
          AND CAST(deposit_datetime AS TIME(0)) = CAST(@transferTime AS TIME(0))
      `);

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

      return res.json({ success: true, message: 'คีย์ยอดสำเร็จ และระบบจับคู่กับสลิปที่แอดมินตรวจไว้แล้ว! (เติมเงินเข้า Wallet แล้ว)' });
    }

    res.json({ success: true, message: 'บันทึกยอดเงินเข้าธนาคารสำเร็จ (รอแอดมินตรวจรูปสลิปให้ตรงกัน ระบบถึงจะจ่ายเงิน)' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: 'ระบบขัดข้อง: ' + error.message });
  }
});

// ==========================================
// API 3: แก้ไขยอดเงินที่คีย์ผิด (แก้ได้เฉพาะที่ยังไม่ถูกจับคู่)
// ==========================================
app.put('/api/admin/key-statement/:id', async (req, res) => {
  try {
    const statementId = req.params.id;
    const { bankId, bankName, accountNumber, amount, transferDate, transferTime } = req.body;

    // คลีนเวลาและยอดเงิน
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

    // 1. ตรวจสอบก่อนว่ารายการนี้ถูกจับคู่ไปหรือยัง? (ถ้าจับคู่แล้ว ห้ามแก้เด็ดขาด)
    const checkStmt = await pool.request()
      .input('id', sql.Int, statementId)
      .query("SELECT is_reconciled FROM Bank_Statements WHERE statement_id = @id");
      
    if (checkStmt.recordset.length === 0) return res.status(404).json({ success: false, message: 'ไม่พบข้อมูล' });
    if (checkStmt.recordset[0].is_reconciled) return res.status(400).json({ success: false, message: 'ไม่อนุญาตให้แก้ไข! รายการนี้กระทบยอดสำเร็จไปแล้ว' });

    // 2. อัปเดตข้อมูลใหม่ลงฐานข้อมูล
    await pool.request()
      .input('id', sql.Int, statementId).input('bankId', sql.Int, bankId).input('bankName', sql.NVarChar, bankName)
      .input('accountNumber', sql.VarChar, accountNumber).input('amount', sql.Decimal(18,2), cleanAmount)
      .input('transferDate', sql.VarChar, transferDate).input('transferTime', sql.VarChar, cleanTime)
      .query(`
        UPDATE Bank_Statements 
        SET bank_id = @bankId, bank_name = @bankName, account_number = @accountNumber, 
            amount = @amount, transfer_date = CAST(@transferDate AS DATE), transfer_time = CAST(@transferTime AS TIME(0))
        WHERE statement_id = @id
      `);

    // 3. หลังจากแก้เสร็จ ให้ระบบวิ่งหากุญแจดอกที่ 1 อีกรอบ (เผื่อแก้แล้วไปตรงกับสลิปพอดี)
    const findSlip = await pool.request()
      .input('amount', sql.Decimal(18,2), cleanAmount).input('accountNumber', sql.VarChar, accountNumber).input('transferDate', sql.VarChar, transferDate).input('transferTime', sql.VarChar, cleanTime)
      .query(`
        SELECT TOP 1 deposit_id, user_id FROM Transactions_Deposit 
        WHERE status = 'Pending' AND reviewed_by = 'Slip Verified'
          AND account_number = @accountNumber AND ABS(amount - @amount) <= 0.01
          AND CAST(deposit_datetime AS DATE) = CAST(@transferDate AS DATE)
          AND CAST(deposit_datetime AS TIME(0)) = CAST(@transferTime AS TIME(0))
      `);

    if (findSlip.recordset.length > 0) {
      const match = findSlip.recordset[0];
      // เจอคู่ตรงกัน! ทำการจ่ายเงินและผูกบิล
      await pool.request().input('depositId', sql.Int, match.deposit_id)
        .query("UPDATE Transactions_Deposit SET status = 'Approved', reviewed_by = 'Bank (Matched)' WHERE deposit_id = @depositId");
      await pool.request().input('userId', sql.Int, match.user_id).input('amount', sql.Decimal(18,2), cleanAmount)
        .query("UPDATE Wallets SET balance = ISNULL(balance, 0) + @amount, last_updated = GETDATE() WHERE user_id = @userId");
      await pool.request().input('userId', sql.Int, match.user_id).input('amount', sql.Decimal(18,2), cleanAmount).input('title', sql.NVarChar(255), 'ฝากเงิน (สำเร็จ)')
        .query("INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at) VALUES (@userId, 'Deposit', @title, @amount, 'Completed', GETDATE())");
      await pool.request().input('stmtId', sql.Int, statementId).input('depositId', sql.Int, match.deposit_id)
        .query("UPDATE Bank_Statements SET is_reconciled = 1, reconciled_with_deposit_id = @depositId WHERE statement_id = @stmtId");

      return res.json({ success: true, message: 'แก้ไขสำเร็จ และระบบจับคู่กับสลิปได้พอดี! (จ่ายเงินแล้ว)' });
    }

    res.json({ success: true, message: 'แก้ไขข้อมูลสำเร็จ (รอกระทบยอด)' });
  } catch (error) {
    console.error('Error in edit-statement:', error);
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
// 🌟 API 2: ระบบ "แนะนำเลข" ตาม % ยอดจ่ายที่เจ้ามือตั้งไว้
// ==========================================
app.post('/api/admin/suggest-draw', async (req, res) => {
    const { targetPercent } = req.body; 
    try {
        const pool = await sql.connect(dbConfig);
        const rateRes = await pool.request().query("SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'");
        const exchangeRate = rateRes.recordset.length > 0 ? rateRes.recordset[0].rate : 620.0;

        const salesRes = await pool.request()
            .query(`SELECT ISNULL(SUM(CASE WHEN currency_code = 'LAK' THEN total_amount / ${exchangeRate} ELSE total_amount END), 0) as totalSalesTHB FROM Lottery_Orders WHERE status = N'รอผลตรวจ'`);
        
        const totalSalesTHB = salesRes.recordset[0].totalSalesTHB || 0;
        const maxPayoutTHB = totalSalesTHB * (targetPercent / 100);

        const itemsRes = await pool.request()
            .query(`
                SELECT 
                    CAST(i.lottery_type AS VARCHAR) as lottery_type, i.selected_number, 
                    CASE WHEN o.currency_code = 'LAK' THEN i.price / ${exchangeRate} ELSE i.price END as price_thb,
                    r.multiplier
                FROM Lottery_Order_Items i
                JOIN Lottery_Orders o ON i.order_id = o.order_id
                LEFT JOIN Lottery_Prize_Rates r ON CAST(i.lottery_type AS INT) = CAST(r.lottery_type AS INT)
                WHERE o.status = N'รอผลตรวจ' AND i.status = N'รอผลตรวจ' AND i.lottery_type IN ('2','3','4','6')
            `);
        
        const pendingItems = itemsRes.recordset;
        let bestNumber = null, bestAnalysis = null, bestPayout = -1;

        for (let i = 0; i < 500; i++) {
            const random6 = Math.floor(100000 + Math.random() * 900000).toString();
            const n4 = random6.slice(-4), n3 = random6.slice(-3), n2 = random6.slice(-2);
            let currentPayout = 0;
            let analysis = { '6': { count: 0, payout: 0 }, '4': { count: 0, payout: 0 }, '3': { count: 0, payout: 0 }, '2': { count: 0, payout: 0 } };

            for (const item of pendingItems) {
                let isWin = false;
                if (item.lottery_type === '6' && item.selected_number === random6) isWin = true;
                else if (item.lottery_type === '4' && item.selected_number === n4) isWin = true;
                else if (item.lottery_type === '3' && item.selected_number === n3) isWin = true;
                else if (item.lottery_type === '2' && item.selected_number === n2) isWin = true;

                if (isWin) {
                    const winAmountTHB = item.price_thb * (item.multiplier || 0);
                    currentPayout += winAmountTHB;
                    analysis[item.lottery_type].count += 1;
                    analysis[item.lottery_type].payout += winAmountTHB;
                }
            }

            if (currentPayout <= maxPayoutTHB && currentPayout > bestPayout) {
                bestPayout = currentPayout; bestNumber = random6; bestAnalysis = analysis;
            }
        }

        if (!bestNumber) {
            bestNumber = Math.floor(100000 + Math.random() * 900000).toString();
            bestAnalysis = { '6': { count: 0, payout: 0 }, '4': { count: 0, payout: 0 }, '3': { count: 0, payout: 0 }, '2': { count: 0, payout: 0 } };
        }

        const analysisArray = Object.keys(bestAnalysis).map(type => ({
            lottery_type: type, winner_count: bestAnalysis[type].count, total_payout: bestAnalysis[type].payout
        }));

        res.json({ success: true, suggestedNumber: bestNumber, totalSales: totalSalesTHB, analysis: analysisArray });
    } catch (err) { res.status(500).json({ success: false }); }
});

// ==========================================
// 🌟 API 3: ค้นหาคนซื้อจากเลข (อิงจากเวลา เปิด-ปิด บิลเป๊ะๆ)
// ==========================================
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

            -- เติมเงินค่าคอมเข้า Wallet ของผู้แนะนำทันที
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

            -- บันทึกประวัติ (Transaction) ให้ผู้แนะนำ ว่าได้รับเงินก้อนนี้มาจากค่าคอมลูกทีมถูกหวย
            INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at)
            SELECT 
                u.user_id, 'Commission', N'ค่าคอมฯ ลูกทีมถูกรางวัล', 
                SUM(i.prize_amount) * (@WinPercent / 100.0), 'Completed', GETDATE()
            FROM Lottery_Order_Items i 
            JOIN Lottery_Orders o ON i.order_id = o.order_id 
            JOIN Users d ON o.user_id = d.user_id
            JOIN Users u ON d.referrer_username = u.username
            WHERE i.status = N'ถูกรางวัล' AND o.status = N'รอผลตรวจ'
            GROUP BY u.user_id
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
// 🌟 API: ดึงข้อมูลและคำนวณค่าคอมของหน้าทีม (/api/team/:uid)
// ==========================================
app.get('/api/team/:uid', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        
        // 1. ดึง Username ของตัวเองก่อน
        const userRes = await pool.request()
            .input('userId', sql.Int, req.params.uid)
            .query('SELECT username FROM Users WHERE user_id = @userId');
        
        if (userRes.recordset.length === 0) return res.json({ success: false, message: 'User not found' });
        const myUsername = userRes.recordset[0].username;

        // 2. ดึงข้อมูลลูกทีม พร้อมคำนวณค่าคอมมิชชัน
        const teamRes = await pool.request()
            .input('myUsername', sql.NVarChar, myUsername)
            .query(`
                DECLARE @PurchPercent DECIMAL(18,2) = (SELECT TOP 1 ISNULL(purchase_percent, 0) FROM Commission_Settings);
                DECLARE @WinPercent DECIMAL(18,2) = (SELECT TOP 1 ISNULL(win_percent, 0) FROM Commission_Settings);

                SELECT 
                    d.user_id as id,
                    d.username as name,
                    'https://ui-avatars.com/api/?name=' + d.username + '&background=random' as avatar,
                    d.is_active as isActive,
                    FORMAT(d.created_at, 'dd/MM/yyyy') as joinDate,
                    
                    -- คำนวณค่าคอมจากการซื้อของลูกทีม (ดึงจากยอดบิลทั้งหมดของคนๆ นี้)
                    CAST(ISNULL((SELECT SUM(total_amount) FROM Lottery_Orders WHERE user_id = d.user_id), 0) * (@PurchPercent / 100.0) AS DECIMAL(18,2)) as purchaseComm,
                    
                    -- คำนวณค่าคอมจากการถูกรางวัลของลูกทีม (ดึงจากยอดถูกรางวัลทั้งหมดของคนๆ นี้)
                    CAST(ISNULL((
                        SELECT SUM(i.prize_amount) 
                        FROM Lottery_Order_Items i 
                        JOIN Lottery_Orders o ON i.order_id = o.order_id 
                        WHERE o.user_id = d.user_id AND i.status = N'ถูกรางวัล'
                    ), 0) * (@WinPercent / 100.0) AS DECIMAL(18,2)) as winComm

                FROM Users d
                WHERE d.referrer_username = @myUsername;
            `);

        // 3. 🌟 อัปเกรด: ดึงรายได้รวมของตัวเองแบบ "ดักจับคำสำคัญ (Keyword)"
        // จับคำว่า "รายได้", "ค่าคอม", "โบนัส" เพื่อให้มั่นใจว่าดึงยอดมาครบแน่นอน 100%
        const incomeRes = await pool.request()
            .input('userId', sql.Int, req.params.uid)
            .query(`
                SELECT 
                    ISNULL(SUM(amount), 0) as totalIncome,
                    ISNULL(SUM(CASE WHEN MONTH(created_at) = MONTH(GETDATE()) AND YEAR(created_at) = YEAR(GETDATE()) THEN amount ELSE 0 END), 0) as incomeThisMonth
                FROM Transactions
                WHERE user_id = @userId 
                  AND amount > 0 
                  AND (
                      transaction_type IN ('Commission', 'Bonus', 'Affiliate Purchase') 
                      OR title LIKE N'%รายได้%' 
                      OR title LIKE N'%ค่าคอม%' 
                      OR title LIKE N'%โบนัส%'
                  );
            `);

        res.json({
            success: true,
            teamMembers: teamRes.recordset,
            totalIncome: incomeRes.recordset[0].totalIncome,
            incomeThisMonth: incomeRes.recordset[0].incomeThisMonth
        });

    } catch (error) {
        console.error(error);
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

app.listen(port, () => {
    console.log(`🚀 Server เปิดทำงานแล้วที่พอร์ต ${port}`);
});