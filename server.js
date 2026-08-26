require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); // <-- ต้องมีแค่บรรทัดเดียวในไฟล์
const cron = require('node-cron');

const app = express();

// ขยายขีดจำกัดให้รองรับรูปภาพสลิป
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const port = process.env.PORT || 5000;

// 🌟 สร้าง Connection Pool สำหรับ PostgreSQL (ต้องมีแค่ชุดเดียวในไฟล์)
const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🛡️ Middleware: สกัดกั้น IP ที่ถูกบล็อกไม่ให้ใช้ API ได้
// ==========================================
app.use(async (req, res, next) => {
    // ดึง IP ของคนที่เรียก API
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    try {
        // 🌟 เปลี่ยนการใช้ mssql pool เป็น pgPool.query
        const blockCheck = await pgPool.query(`
            SELECT is_blocked FROM Blocked_IPs WHERE ip_address = $1 AND is_blocked = '1'
        `, [clientIp]);
            
        if (blockCheck.rows.length > 0) {
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
// ==========================================
// 🗄️ การเชื่อมต่อ PostgreSQL (Vercel Neon) สำหรับตาราง Video
// ==========================================

// ตรวจสอบว่าต่อติดไหม
pgPool.connect((err, client, release) => {
  if (err) {
    return console.error('❌ เชื่อมต่อ Vercel Postgres ไม่สำเร็จ:', err.stack);
  }
  console.log('✅ เชื่อมต่อ Vercel Postgres สำเร็จพร้อมลุยตารางวิดีโอแล้วครับ!');
  if(release) release();
});

// // ตั้งค่าการเชื่อมต่อฐานข้อมูล
// const dbConfig = {
//     user: process.env.DB_USER,
//     password: process.env.DB_PASSWORD,
//     server: process.env.DB_SERVER, 
//     database: process.env.DB_DATABASE,
//     options: {
//         encrypt: false, // somee.com มักจะไม่บังคับใช้ encrypt
//         trustServerCertificate: true 
//     }
// };
// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// ==========================================

// ทดสอบเชื่อมต่อฐานข้อมูล
pgPool.query('SELECT NOW()').then(() => {
    console.log("✅ เชื่อมต่อฐานข้อมูล Vercel Postgres สำเร็จ!");
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
        const res = await pgPool.query(`
            SELECT 
                to_char(close_time, 'HH24:MI') as close_time,
                to_char(open_time, 'HH24:MI') as open_time,
                to_char(draw_time, 'HH24:MI') as draw_time,
                is_auto_draw, auto_draw_percent
            FROM System_Settings WHERE id = 1
        `);
        
        if (res.rows.length > 0) {
            const { close_time, open_time, draw_time, is_auto_draw, auto_draw_percent } = res.rows[0];
            
            const currentTime = new Date().toLocaleTimeString('en-US', { 
                timeZone: 'Asia/Bangkok', hour12: false, hour: '2-digit', minute: '2-digit' 
            });

            if (currentTime === close_time) {
                await pgPool.query("UPDATE System_Settings SET is_sales_open = 0 WHERE id = 1");
            }
            if (currentTime === open_time) {
                await pgPool.query("UPDATE System_Settings SET is_sales_open = 1 WHERE id = 1");
            }

            // 🌟 เช็คเวลาออกรางวัล
            if (currentTime === draw_time) {
                if (!is_auto_draw) return; // แอดมินปิดออโต้ไว้

                const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
                
                // เช็คว่าวันนี้หวยเวียดนามออกผลไปหรือยัง ป้องกันออโต้ทำงานซ้ำ
                const checkDraw = await pgPool.query(`SELECT 1 FROM Draw_Results WHERE draw_date = $1`, [today]);
                if (checkDraw.rows.length > 0) return; 

                console.log(`🎰 [AUTO-VIETNAM] เริ่มสุ่มเลขเป้าหมายที่ ${auto_draw_percent}%...`);

                const rateRes = await pgPool.query("SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'");
                const exchangeRate = rateRes.rows.length > 0 ? rateRes.rows[0].rate : 620.0;
                
                const salesRes = await pgPool.query(`SELECT COALESCE(SUM(CASE WHEN currency_code = 'LAK' THEN total_amount / $1 ELSE total_amount END), 0) as totalSalesTHB FROM Lottery_Orders WHERE status = 'รอผลตรวจ'`, [exchangeRate]);
                const maxPayoutTHB = (salesRes.rows[0].totalsalesthb || 0) * (auto_draw_percent / 100);

                const itemsRes = await pgPool.query(`
                    SELECT CAST(i.lottery_type AS VARCHAR) as lottery_type, i.selected_number, 
                    CASE WHEN o.currency_code = 'LAK' THEN i.price / $1 ELSE i.price END as price_thb, r.multiplier
                    FROM Lottery_Order_Items i JOIN Lottery_Orders o ON i.order_id = o.order_id
                    LEFT JOIN Lottery_Prize_Rates r ON CAST(i.lottery_type AS VARCHAR) = CAST(r.lottery_type AS VARCHAR)
                    WHERE o.status = 'รอผลตรวจ' AND i.status = 'รอผลตรวจ' 
                `, [exchangeRate]);
                
                let bestNumber6 = null, bestPayout = -1;
                for (let i = 0; i < 500; i++) {
                    const random6 = Math.floor(100000 + Math.random() * 900000).toString();
                    const n4 = random6.slice(-4), n3 = random6.slice(-3), n2 = random6.slice(-2);
                    let currentPayout = 0;
                    for (const item of itemsRes.rows) {
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

                // 🌟 เริ่มระบบ Transaction ของ PostgreSQL (pg)
                const client = await pgPool.connect();
                try {
                    await client.query('BEGIN'); // เริ่ม Transaction

                    // 1. บันทึกตารางผลเวียดนาม
                    await client.query(`
                        INSERT INTO Draw_Results (draw_date, prize_8, prize_6, prize_4, prize_3, prize_2) 
                        VALUES ($1, $2, $3, $4, $5, $6);
                    `, [today, num8, num6, num4, num3, num2]);

                    const commReq = await client.query("SELECT win_percent FROM Commission_Settings LIMIT 1");
                    const commPercent = commReq.rows.length > 0 ? commReq.rows[0].win_percent : 0;

                    // 2. ตัดบิล (แก้ไขรูปแบบ UPDATE JOIN เป็นของ Postgres)
                    await client.query(`
                        UPDATE Lottery_Order_Items i SET 
                            status = CASE 
                                WHEN (i.lottery_type = '2 ล่าง' AND i.selected_number = $1) OR
                                     (i.lottery_type = '2' AND i.selected_number = $1) OR
                                     (i.lottery_type = '3' AND i.selected_number = $2) OR
                                     (i.lottery_type = '4' AND i.selected_number = $3) OR
                                     (i.lottery_type = '6' AND i.selected_number = $4) OR
                                     (i.lottery_type = '8' AND i.selected_number = $5) THEN 'ถูกรางวัล'
                                ELSE 'ไม่ถูกรางวัล'
                            END,
                            prize_amount = CASE
                                WHEN (i.lottery_type = '2 ล่าง' AND i.selected_number = $1) OR
                                     (i.lottery_type = '2' AND i.selected_number = $1) OR
                                     (i.lottery_type = '3' AND i.selected_number = $2) OR
                                     (i.lottery_type = '4' AND i.selected_number = $3) OR
                                     (i.lottery_type = '6' AND i.selected_number = $4) OR
                                     (i.lottery_type = '8' AND i.selected_number = $5) 
                                THEN i.price * COALESCE((SELECT multiplier FROM Lottery_Prize_Rates WHERE CAST(lottery_type AS VARCHAR) = CAST(i.lottery_type AS VARCHAR) LIMIT 1), 0)
                                ELSE 0
                            END
                        FROM Lottery_Orders o
                        WHERE i.order_id = o.order_id AND o.status = 'รอผลตรวจ' AND i.status = 'รอผลตรวจ';
                    `, [num2, num3, num4, num6, num8]);

                    // 3. จ่ายรางวัล (แก้ไขรูปแบบ UPDATE JOIN)
                    await client.query(`
                        UPDATE Wallets w SET balance = COALESCE(w.balance, 0) + t.TotalPrize
                        FROM (
                            SELECT o.user_id, SUM(i.prize_amount) as TotalPrize
                            FROM Lottery_Order_Items i JOIN Lottery_Orders o ON i.order_id = o.order_id 
                            WHERE i.status = 'ถูกรางวัล' AND o.status = 'รอผลตรวจ' GROUP BY o.user_id
                        ) t WHERE w.user_id = t.user_id;
                    `);

                    await client.query(`
                        INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at)
                        SELECT o.user_id, 'Reward', 'ถูกรางวัลหวยเวียดนาม', SUM(i.prize_amount), 'Completed', CURRENT_TIMESTAMP
                        FROM Lottery_Order_Items i JOIN Lottery_Orders o ON i.order_id = o.order_id 
                        WHERE i.status = 'ถูกรางวัล' AND o.status = 'รอผลตรวจ' GROUP BY o.user_id;
                    `);

                    // 4. จ่ายค่าคอม
                    if (commPercent > 0) {
                        await client.query(`
                            UPDATE Wallets w SET balance = COALESCE(w.balance, 0) + t.CommAmount
                            FROM (
                                SELECT d.referrer_username, SUM(i.prize_amount) * ($1 / 100.0) as CommAmount
                                FROM Lottery_Order_Items i JOIN Lottery_Orders o ON i.order_id = o.order_id 
                                JOIN Users d ON o.user_id = d.user_id
                                WHERE i.status = 'ถูกรางวัล' AND o.status = 'รอผลตรวจ' AND d.referrer_username IS NOT NULL
                                GROUP BY d.referrer_username HAVING SUM(i.prize_amount) > 0
                            ) t WHERE w.user_id = (SELECT user_id FROM Users WHERE username = t.referrer_username LIMIT 1);
                        `, [commPercent]);
                            
                        await client.query(`
                            INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at)
                            SELECT (SELECT user_id FROM Users WHERE username = d.referrer_username LIMIT 1), 'Commission', 'ค่าคอมฯ ลูกทีมถูกรางวัล (' || d.username || ')', SUM(i.prize_amount) * ($1 / 100.0), 'Completed', CURRENT_TIMESTAMP
                            FROM Lottery_Order_Items i JOIN Lottery_Orders o ON i.order_id = o.order_id 
                            JOIN Users d ON o.user_id = d.user_id
                            WHERE i.status = 'ถูกรางวัล' AND o.status = 'รอผลตรวจ' AND d.referrer_username IS NOT NULL
                            GROUP BY d.referrer_username, d.username HAVING SUM(i.prize_amount) > 0;
                        `, [commPercent]);
                    }

                    // 5. ปิดบิลแม่
                    await client.query(`UPDATE Lottery_Orders SET status = 'ตรวจผลแล้ว', draw_date = CURRENT_TIMESTAMP WHERE status = 'รอผลตรวจ';`);
                    
                    await client.query('COMMIT'); // สั่งยืนยัน Transaction
                    console.log(`✅ [AUTO-VIETNAM] ออกรางวัล บันทึกตาราง และจ่ายเงินสำเร็จเรียบร้อย!`);
                } catch (innerErr) {
                    await client.query('ROLLBACK'); // ยกเลิก Transaction ถ้าพัง
                    console.error('❌ [AUTO-VIETNAM] DB Transaction Error:', innerErr);
                } finally {
                    client.release(); // คืน Connection ให้ Pool เสมอ!
                }
            }
        }
    } catch (err) {
        console.error('❌ เกิดข้อผิดพลาดในระบบตั้งเวลาอัตโนมัติหวยเวียดนาม:', err);
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API สำหรับระบบเมนูอัจฉริยะ (Dynamic Menu)
// ==========================================
// 1. ดึงข้อมูลเมนูทั้งหมด (GET) - ส่งไปให้ React วาดเมนูซ้ายมือ
app.get('/api/menus', async (req, res) => {
    try {
        const result = await pgPool.query(`
            SELECT 
                menu_id AS id, 
                title, 
                path, 
                icon, 
                component, 
                parent_id AS "parentId", 
                show_notification AS "showNotification"
            FROM System_Menus
            ORDER BY parent_id, sort_order, menu_id
        `);
        
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching menus:', err);
        res.status(500).send('Server error');
    }
});

// 2. เพิ่มเมนูใหม่ลง Database (POST)
app.post('/api/menus', async (req, res) => {
    const { title, path, icon, component, parentId, showNotification } = req.body;
    
    try {
        const result = await pgPool.query(`
                INSERT INTO System_Menus (title, path, icon, component, parent_id, show_notification)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING menu_id AS id
            `, 
            [
                title, 
                path || null, 
                icon || null, 
                component || null, 
                parentId || null, 
                showNotification === false ? 0 : 1
            ]
        );
            
        res.status(201).json({ 
            message: 'บันทึกเมนูสำเร็จ', 
            id: result.rows[0].id 
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
        await pgPool.query(`
                UPDATE System_Menus 
                SET title = $1, path = $2, icon = $3, component = $4, 
                    parent_id = $5, show_notification = $6
                WHERE menu_id = $7
            `, 
            [
                title, 
                path || null, 
                icon || null, 
                component || null, 
                parentId || null, 
                showNotification === false ? 0 : 1,
                id
            ]
        );
            
        res.json({ message: 'อัปเดตเมนูสำเร็จ' });
    } catch (err) {
        console.error('Error updating menu:', err);
        res.status(500).send('Server error');
    }
});

// 4. ลบเมนู (DELETE)
app.delete('/api/menus/:id', async (req, res) => {
    const { id } = req.params;
    
    // 🌟 ใช้ Transaction สำหรับการลบข้อมูลที่เกี่ยวข้องกัน 2 ตาราง
    const client = await pgPool.connect();
    try {
        await client.query('BEGIN');
        
        // ลบเมนูลูกก่อน
        await client.query(`DELETE FROM System_Menus WHERE parent_id = $1`, [id]);
        // ลบเมนูแม่
        await client.query(`DELETE FROM System_Menus WHERE menu_id = $1`, [id]);
        
        await client.query('COMMIT');
        res.json({ message: 'ลบเมนูสำเร็จ' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error deleting menu:', err);
        res.status(500).send('Server error');
    } finally {
        client.release();
    }
});

// ==========================================
// API 1: ตรวจสอบผู้แนะนำ (Check Referrer)
// ==========================================
app.get('/api/check-referrer/:username', async (req, res) => {
  const username = req.params.username;

  try {
    const result = await pgPool.query(`
        SELECT u.username, un.firstname, un.lastname
        FROM Users u
        LEFT JOIN UserName_Lastname un ON u.user_id = un.user_id
        WHERE u.username = $1
      `, [username]);

    if (result.rows.length > 0) {
      const user = result.rows[0];
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
    const result = await pgPool.query('SELECT username FROM Users WHERE username = $1', [username]);

    if (result.rows.length > 0) {
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
    // 1. เช็กซ้ำอีกรอบเพื่อความชัวร์ว่าชื่อยังไม่มีคนใช้
    const checkUser = await pgPool.query('SELECT username FROM Users WHERE username = $1', [username]);
      
    if (checkUser.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'ชื่อผู้ใช้นี้มีคนใช้แล้ว' });
    }

    // 2. กำหนดค่าเริ่มต้นสำหรับสมาชิกใหม่
    const currency_code = country === 'Laos' ? 'LAK' : 'THB';
    const role_id = 4;  // สมมติให้ 4 คือ Role ของ User ทั่วไป
    const level_id = 1; // 1 คือลูกค้าระดับเริ่มต้น (ลูกค้าใหม่)
    
    // 3. บันทึกข้อมูลลงตาราง Users 
    const insertResult = await pgPool.query(`
        INSERT INTO Users (username, password_hash, referrer_username, country, currency_code, role_id, level_id, is_active, created_at, wallet_balance, total_orders)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 1, CURRENT_TIMESTAMP, 0, 0)
        RETURNING user_id
      `, [username, password, referrer || null, country, currency_code, role_id, level_id]
    );
      
    // ดึง user_id ที่เพิ่งถูกสร้างขึ้นมา
    const newUserId = insertResult.rows[0].user_id;

    // 4. สร้างกระเป๋าเงิน (Wallets) และข้อมูลชื่อพื้นฐานให้ User ใหม่ด้วย
    // แยกเป็น 2 คำสั่งเพื่อให้ทำงานกับ pgPool ได้อย่างสมบูรณ์แบบและไม่มี Error
    await pgPool.query(`INSERT INTO UserName_Lastname (user_id, firstname, lastname) VALUES ($1, 'ผู้ใช้', 'ใหม่')`, [newUserId]);
    await pgPool.query(`INSERT INTO Wallets (user_id, balance, points) VALUES ($1, 0, 0)`, [newUserId]);

    res.json({ success: true, message: 'สมัครสมาชิกสำเร็จ' });

  } catch (err) {
    console.error('Register API Error:', err);
    res.status(500).json({ success: false, message: 'ระบบขัดข้อง ไม่สามารถบันทึกข้อมูลได้' });
  }
});

// ==========================================
//  การเชื่อมต่อ PostgreSQL (Vercel Neon)  ด้าน บนแก้แล้ว
// ==========================================


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// API 1: ดึงรายชื่อธนาคารทั้งหมด (จากตาราง Banks)
// ==========================================
app.get('/api/banks', async (req, res) => {
  try {
    const result = await pgPool.query("SELECT * FROM Banks WHERE is_active = '1'");
    res.json({ success: true, banks: result.rows });
  } catch (err) {
    console.error('Error fetching banks:', err);
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลธนาคารได้' });
  }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🏦 API ดึงบัญชีธนาคารของลูกค้า (หน้าแอป)
// ==========================================
app.get('/api/user-profile-banks/:uid', async (req, res) => {
    try {
        const uid = req.params.uid;
        
        const result = await pgPool.query(`
            SELECT ub.*, b.bank_name, b.logo_url, b.country 
            FROM UserBanks ub 
            LEFT JOIN Banks b ON ub.bank_id = b.bank_id 
            WHERE ub.user_id = $1
        `, [uid]);
            
        res.json({ success: true, userBanks: result.rows });
    } catch (error) {
        console.error('Error fetching user banks:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// API 3: เพิ่มบัญชีธนาคาร พร้อมอัปเดตชื่อ-นามสกุล
// ==========================================
app.post('/api/add-user-bank', async (req, res) => {
  const { userId, firstname, lastname, bankId, accountName, accountNumber, currencyCode, passbookBase64 } = req.body;
  
  // 🌟 ใช้ Transaction สำหรับการบันทึกข้อมูลหลายตาราง
  const client = await pgPool.connect();
  
  try {
    await client.query('BEGIN'); // เริ่ม Transaction
    
    // 1. อัปเดตชื่อ-นามสกุลในระบบให้ตรงกับบัญชีธนาคาร
    await client.query(`
        UPDATE UserName_Lastname 
        SET firstname = $1, lastname = $2 
        WHERE user_id = $3
    `, [firstname, lastname, userId]);

    // 2. บันทึกบัญชีธนาคาร พร้อมรูปสมุดบัญชี และตั้งสถานะเป็น Pending (รอตรวจสอบ)
    await client.query(`
        INSERT INTO UserBanks 
        (user_id, bank_id, account_name, account_number, currency_code, is_primary, passbook_image, status, created_at)
        VALUES 
        ($1, $2, $3, $4, $5, '1', $6, 'Pending', CURRENT_TIMESTAMP)
    `, [userId, bankId, accountName, accountNumber, currencyCode, passbookBase64]);

    await client.query('COMMIT'); // ยืนยัน Transaction เมื่อทุกอย่างสำเร็จ
    res.json({ success: true, message: 'เพิ่มบัญชีธนาคารสำเร็จ กรุณารอแอดมินตรวจสอบ' });
    
  } catch (err) {
    await client.query('ROLLBACK'); // ยกเลิกการบันทึกทั้งหมดถ้ามีจุดใดจุดหนึ่งล้มเหลว
    console.error('Error adding user bank:', err);
    res.status(500).json({ success: false, message: 'ไม่สามารถเพิ่มบัญชีได้' });
  } finally {
    client.release(); // คืน Connection ให้ Pool เสมอ
  }
});
// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
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
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 1. API สำหรับ Login (อัปเดตดึงข้อมูลครบถ้วน + 🛡️ ระบบเฝ้าระวัง IP)
// ==========================================
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  // 🛡️ [เพิ่มใหม่ระบบ IP]: ดึง IP Address ของคนที่พยายาม Login
  let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
  if (clientIp.includes(',')) clientIp = clientIp.split(',')[0].trim(); // ป้องกันกรณีดึงได้หลาย IP ซ้อนกัน

  try {
    // 🛡️ [เพิ่มใหม่ระบบ IP]: 1. เช็คก่อนเลยว่า IP นี้ติดแบล็คลิสต์ (บล็อก) อยู่หรือไม่
    // หมายเหตุ: Postgres คอลัมน์ Bit ใช้ค่า '1' เป็น String
    const blockCheck = await pgPool.query(`SELECT is_blocked FROM Blocked_IPs WHERE ip_address = $1 AND is_blocked = '1'`, [clientIp]);
        
    if (blockCheck.rows.length > 0) {
        return res.status(403).json({ success: false, message: 'IP ของคุณถูกบล็อก เนื่องจากพยายามเข้าระบบผิดพลาดหลายครั้ง' });
    }

    // 🛡️ [เพิ่มใหม่ระบบ IP]: ฟังก์ชันย่อยสำหรับนับจำนวนครั้งที่เข้าสู่ระบบผิดพลาด
    const handleFailedLogin = async () => {
        // บันทึกประวัติว่า IP นี้ใส่รหัสผิด
        await pgPool.query(`INSERT INTO Login_Failed_Attempts (ip_address, attempt_time) VALUES ($1, CURRENT_TIMESTAMP)`, [clientIp]);

        // นับดูว่าใน 1 นาทีที่ผ่านมา IP นี้ผิดไปกี่ครั้งแล้ว
        const failCheck = await pgPool.query(`
            SELECT COUNT(id) as fail_count 
            FROM Login_Failed_Attempts 
            WHERE ip_address = $1 AND attempt_time >= CURRENT_TIMESTAMP - INTERVAL '1 minute'
        `, [clientIp]);

        const failCount = parseInt(failCheck.rows[0].fail_count, 10);

        // ถ้าผิดตั้งแต่ 10 ครั้งขึ้นไป ให้จับบล็อกทันที
        if (failCount >= 10) {
            // เช็คว่ามี IP นี้อยู่ใน Blocked_IPs หรือยัง
            const existCheck = await pgPool.query(`SELECT 1 FROM Blocked_IPs WHERE ip_address = $1`, [clientIp]);
            
            if (existCheck.rows.length === 0) {
                // ถ้ายังไม่มีให้ Insert
                await pgPool.query(`
                    INSERT INTO Blocked_IPs (ip_address, reason, is_blocked, updated_at) 
                    VALUES ($1, 'Brute Force Login Attempt (>10 fails/min)', '1', CURRENT_TIMESTAMP)
                `, [clientIp]);
            } else {
                // ถ้ามีแล้วให้ Update
                await pgPool.query(`
                    UPDATE Blocked_IPs 
                    SET is_blocked = '1', reason = 'Brute Force Login Attempt (>10 fails/min)', updated_at = CURRENT_TIMESTAMP 
                    WHERE ip_address = $1
                `, [clientIp]);
            }
            return true; // แจ้งว่าโดนบล็อกแล้ว
        }
        return false; // ยังไม่โดนบล็อก
    };
    
    // 🌟 ดึงข้อมูล User พร้อมกับ Role, Level, ชื่อ-นามสกุล, ประเทศ และ สกุลเงิน
    const userResult = await pgPool.query(`
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
        WHERE u.username = $1
    `, [username]);

    // ถ้าไม่เจอ Username ในระบบ
    if (userResult.rows.length === 0) {
      // 🛡️ [เพิ่มใหม่ระบบ IP]: บันทึกว่าใส่ข้อมูลผิด
      const isBlockedNow = await handleFailedLogin();
      if (isBlockedNow) {
          return res.status(403).json({ message: 'IP ของคุณถูกบล็อก เนื่องจากพยายามเข้าระบบผิดพลาดหลายครั้ง' });
      }
      return res.status(401).json({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    const user = userResult.rows[0];

    // เช็คว่า User ถูกระงับการใช้งานหรือไม่ 
    // (รองรับทั้งแบบ Boolean, Number และ String '0' จาก Postgres)
    if (user.is_active === false || user.is_active === 0 || user.is_active === '0') {
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
    await pgPool.query(`DELETE FROM Login_Failed_Attempts WHERE ip_address = $1`, [clientIp]);

    // 🌟 ส่งข้อมูลกลับไปให้ Frontend แบบจัดเต็ม
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
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// API: ดึงอัตราแลกเปลี่ยน (Exchange Rates)
// ==========================================
app.get('/api/exchange-rates', async (req, res) => {
  try {
    // ดึงข้อมูลทั้งหมดจากตาราง ExchangeRates
    const result = await pgPool.query('SELECT currency_pair, rate, last_updated FROM ExchangeRates');

    // จัด Format ให้อ่านง่าย เช่น { "THB_LAK": 620.00, "USD_THB": 36.00 }
    const rates = {};
    let lastUpdated = null;
    
    result.rows.forEach(row => {
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
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// API สำหรับ Register (อัปเดตรองรับประเทศและสกุลเงิน)
// ==========================================
app.post('/api/register', async (req, res) => {
  // 🌟 รับค่า country เพิ่มเข้ามาจาก Frontend
  const { username, password, referrer, country } = req.body;

  try {
    // ตรวจสอบว่า Username ซ้ำไหม (โค้ดเดิมของคุณ)
    // ... 

    // 🌟 กำหนดสกุลเงินตามประเทศที่เลือก
    let currencyCode = 'THB'; // ค่าเริ่มต้น
    let selectedCountry = country || 'Thailand';

    if (selectedCountry.toLowerCase() === 'laos') {
      currencyCode = 'LAK';
    }

    // 🌟 บันทึกลงฐานข้อมูล (เพิ่ม country และ currency_code เข้าไปในคำสั่ง INSERT)
    await pgPool.query(`
        INSERT INTO Users (username, password_hash, referrer_username, role_id, level_id, is_active, country, currency_code)
        VALUES ($1, $2, $3, 4, 1, '1', $4, $5)
      `, 
      [username, password, referrer || null, selectedCountry, currencyCode]
    );
    // หมายเหตุ: role_id 4 = User ทั่วไป, level_id 1 = ระดับเริ่มต้น, is_active '1' = เปิดใช้งาน

    res.status(201).json({ message: 'สมัครสมาชิกสำเร็จ' });

  } catch (err) {
    console.error('Register API Error:', err);
    res.status(500).json({ message: 'ระบบขัดข้อง ไม่สามารถสมัครสมาชิกได้' });
  }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// API: ดึงข้อมูลหน้า Dashboard (Wallet & Transactions)
// ==========================================
app.get('/api/dashboard/:userId', async (req, res) => {
  const userId = req.params.userId;
  
  try {
    // 1. ดึงข้อมูลกระเป๋าเงิน
    const walletResult = await pgPool.query('SELECT balance, points FROM Wallets WHERE user_id = $1', [userId]);
      
    let wallet = walletResult.rows[0];
    
    // ถ้าเพิ่งสมัครและยังไม่มีกระเป๋าเงิน ให้ส่งค่า 0 กลับไป
    if (!wallet) {
      wallet = { balance: 0.00, points: 0 };
    }

    // 2. ดึงรายการธุรกรรมล่าสุด 5 รายการ (🌟 เปลี่ยน TOP 5 เป็น LIMIT 5)
    const txResult = await pgPool.query(`
        SELECT transaction_id, transaction_type, title, amount, status, created_at 
        FROM Transactions 
        WHERE user_id = $1 
        ORDER BY created_at DESC
        LIMIT 5
      `, [userId]);
      
    const transactions = txResult.rows;

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
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// API: แจ้งฝากเงิน (Deposit)
// ==========================================
app.post('/api/deposit', async (req, res) => {
  const { userId, systemBankId, amount, slipBase64 } = req.body;

  // ตรวจสอบว่าส่งข้อมูลมาครบหรือไม่
  if (!userId || !systemBankId || !amount || !slipBase64) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วนและแนบสลิป' });
  }

  try {
    // 1. ดึงชื่อธนาคารระบบ เพื่อเอามาตั้งชื่อรายการให้สวยงาม (เช่น "แจ้งฝากเงินเข้า KBANK")
    const bankReq = await pgPool.query('SELECT bank_name, bank_code FROM Banks WHERE bank_id = $1', [systemBankId]);
      
    let bankInfo = 'บัญชีระบบ';
    if (bankReq.rows.length > 0) {
      bankInfo = bankReq.rows[0].bank_code;
    }

    const title = `แจ้งฝากเงินเข้า ${bankInfo}`;

    // 2. บันทึกข้อมูลลงตาราง Transactions พร้อมตั้งสถานะเป็น 'Pending' (รอตรวจสอบ)
    // 🌟 เปลี่ยน GETDATE() เป็น CURRENT_TIMESTAMP
    await pgPool.query(`
        INSERT INTO Transactions 
        (user_id, title, amount, transaction_type, status, system_bank_id, slip_image, created_at)
        VALUES 
        ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
      `, 
      [userId, title, amount, 'Deposit', 'Pending', systemBankId, slipBase64]
    );

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
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// API: (Admin) ดึงรายการฝากเงินที่รอตรวจสอบทั้งหมด
// ==========================================
app.get('/api/admin/pending-deposits', async (req, res) => {
  try {
    const result = await pgPool.query(`
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
    res.json({ success: true, transactions: result.rows });
  } catch (error) {
    console.error('Fetch Pending Deposits Error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
  }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// API: (Admin) จัดการอนุมัติ หรือ ปฏิเสธ รายการฝากเงิน
// ==========================================
app.post('/api/admin/manage-deposit', async (req, res) => {
  const { transactionId, action } = req.body; // action ส่งมาเป็น 'approve' หรือ 'reject'

  if (!transactionId || !action) {
    return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });
  }

  try {
    // เช็คก่อนว่ารายการนี้ยังมีอยู่และรอตรวจสอบจริงไหม
    const txReq = await pgPool.query("SELECT * FROM Transactions WHERE transaction_id = $1 AND status = 'Pending'", [transactionId]);

    if (txReq.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบรายการ หรือรายการนี้ถูกจัดการไปแล้ว' });
    }

    const tx = txReq.rows[0];

    if (action === 'approve') {
      // 🌟 ถ้า "อนุมัติ" ต้องใช้ Transaction ล็อคการทำงาน 2 อย่าง (เปลี่ยนสถานะ + เติมเงิน)
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN'); // เริ่ม Transaction

        // 1. เปลี่ยนสถานะเป็น Completed
        await client.query("UPDATE Transactions SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE transaction_id = $1", [transactionId]);

        // 2. เติมเงินเข้ากระเป๋า
        await client.query("UPDATE Wallets SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2", [tx.amount, tx.user_id]);

        await client.query('COMMIT'); // ยืนยันข้อมูล
        res.json({ success: true, message: 'อนุมัติยอดเงินเข้ากระเป๋าลูกค้าสำเร็จ!' });
      } catch (err) {
        await client.query('ROLLBACK'); // ยกเลิกถ้าเกิด Error
        throw err;
      } finally {
        client.release(); // คืน Connection
      }

    } else if (action === 'reject') {
      // 🌟 ถ้า "ปฏิเสธ" (สลิปปลอม/ยอดไม่เข้า) แค่เปลี่ยนสถานะเป็น Rejected
      await pgPool.query("UPDATE Transactions SET status = 'Rejected', updated_at = CURRENT_TIMESTAMP WHERE transaction_id = $1", [transactionId]);
      
      res.json({ success: true, message: 'ปฏิเสธรายการสำเร็จ (ลูกค้าจะไม่ได้รับเงิน)' });
    }

  } catch (error) {
    console.error('Manage Deposit Error:', error);
    res.status(500).json({ success: false, message: 'ระบบเซิร์ฟเวอร์ขัดข้อง' });
  }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// API: (Admin) จัดการอนุมัติ หรือ ปฏิเสธ บัญชีธนาคารลูกค้า
// ==========================================
app.post('/api/admin/verify-customer-bank', async (req, res) => {
  const { userBankId, action } = req.body; // รับค่า 'Approved' หรือ 'Rejected'

  if (!userBankId || !action) {
    return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });
  }

  try {
    await pgPool.query("UPDATE UserBanks SET status = $1 WHERE user_bank_id = $2", [action, userBankId]);
      
    res.json({ success: true, message: action === 'Approved' ? 'อนุมัติบัญชีสำเร็จ' : 'ปฏิเสธบัญชีสำเร็จ' });
  } catch (error) {
    console.error('Verify Bank Error:', error);
    res.status(500).json({ success: false, message: 'ระบบเซิร์ฟเวอร์ขัดข้อง' });
  }
});
// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// API: (Admin) จัดการอนุมัติ หรือ ปฏิเสธ รายการฝากเงิน
// ==========================================
app.post('/api/admin/manage-deposit', async (req, res) => {
  const { transactionId, action } = req.body; 

  if (!transactionId || !action) {
    return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });
  }

  try {
    const txReq = await pgPool.query("SELECT * FROM Transactions WHERE transaction_id = $1 AND status = 'Pending'", [transactionId]);

    if (txReq.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบรายการ หรือรายการนี้ถูกจัดการไปแล้ว' });
    }

    const tx = txReq.rows[0];

    if (action === 'approve') {
      // 🌟 ใช้ Transaction ล็อคการทำงาน 2 อย่าง (เปลี่ยนสถานะ + เติมเงิน)
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN'); // เริ่ม Transaction

        // 1. เปลี่ยนสถานะเป็น Completed
        await client.query("UPDATE Transactions SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE transaction_id = $1", [transactionId]);

        // 2. เติมเงินเข้ากระเป๋า
        await client.query("UPDATE Wallets SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2", [tx.amount, tx.user_id]);

        await client.query('COMMIT'); // ยืนยันข้อมูล
        res.json({ success: true, message: 'อนุมัติยอดเงินเข้ากระเป๋าลูกค้าสำเร็จ!' });
      } catch (err) {
        await client.query('ROLLBACK'); // ยกเลิกถ้าเกิด Error
        throw err;
      } finally {
        client.release(); // คืน Connection เสมอ
      }

    } else if (action === 'reject') {
      // 🌟 ถ้า "ปฏิเสธ" (สลิปปลอม/ยอดไม่เข้า) แค่เปลี่ยนสถานะเป็น Rejected
      await pgPool.query("UPDATE Transactions SET status = 'Rejected', updated_at = CURRENT_TIMESTAMP WHERE transaction_id = $1", [transactionId]);
      
      res.json({ success: true, message: 'ปฏิเสธรายการสำเร็จ (ลูกค้าจะไม่ได้รับเงิน)' });
    }

  } catch (error) {
    console.error('Manage Deposit Error:', error);
    res.status(500).json({ success: false, message: 'ระบบเซิร์ฟเวอร์ขัดข้อง' });
  }
});



// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 1. API ดึงรายการคำขอเพิ่มบัญชีธนาคารทั้งหมด (แอดมิน)
// ==========================================
app.get('/api/admin/user-banks', async (req, res) => {
    try {
        const result = await pgPool.query(`
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
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('Error fetching user banks:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🗑️ [CLIENT] ลบสมุดบัญชี (แบบ Soft Delete ไม่ลบจริงจากฐานข้อมูล)
// ==========================================
app.delete('/api/user-banks/:id', async (req, res) => {
    try {
        const bankId = req.params.id;
        
        // 🌟 อัปเดตสถานะเป็น Deleted แทนการใช้คำสั่ง DELETE FROM
        await pgPool.query(`UPDATE UserBanks SET status = 'Deleted' WHERE user_bank_id = $1`, [bankId]);
            
        res.json({ success: true, message: 'ลบบัญชีสำเร็จ' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error: ' + err.message });
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🏦 [ADMIN] อนุมัติ / ปฏิเสธ สมุดบัญชีลูกค้า
// ==========================================
app.put('/api/admin/user-banks/:id/status', async (req, res) => {
    try {
        const user_bank_id = req.params.id;
        const { status, reject_reason } = req.body; 
        
        // อัปเดตสถานะสมุดบัญชี และใส่เหตุผลที่ไม่อนุมัติ (ถ้ามี)
        await pgPool.query(`
                UPDATE UserBanks 
                SET status = $1, 
                    reject_reason = $2
                WHERE user_bank_id = $3
            `, [status, reject_reason || null, user_bank_id]
        );
            
        res.json({ success: true, message: 'อัปเดตสถานะสมุดบัญชีสำเร็จ' });
    } catch (err) {
        console.error("เกิดข้อผิดพลาดในการอัปเดตสถานะบัญชี:", err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์: ' + err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// ✏️ [CLIENT] แก้ไขสมุดบัญชีที่โดนปฏิเสธ (ส่งตรวจใหม่)
// ==========================================
app.put('/api/user-banks/:id', async (req, res) => {
    try {
        const bankId = req.params.id;
        const { firstname, lastname, bankId: newBankId, accountNumber, currencyCode, passbookBase64 } = req.body;
        const accountName = `${firstname} ${lastname}`;

        let updateQuery = `
            UPDATE UserBanks 
            SET bank_id = $1, 
                account_number = $2, 
                account_name = $3, 
                currency_code = $4, 
                status = 'Re-submitted' /* 🌟 1. เปลี่ยนสถานะเป็น "ส่งเรื่องแก้แล้ว" */
                /* 🌟 2. เอาคำสั่ง reject_reason = NULL ออก (เก็บความจำไว้ให้แอดมินดู) */
        `;
        
        // จัดเตรียมตัวแปรสำหรับการ Query
        let queryParams = [newBankId, accountNumber, accountName, currencyCode];

        // สร้างเงื่อนไข Query แบบ Dynamic
        if (passbookBase64) {
            updateQuery += `, passbook_image = $5 WHERE user_bank_id = $6`;
            queryParams.push(passbookBase64, bankId);
        } else {
            updateQuery += ` WHERE user_bank_id = $5`;
            queryParams.push(bankId);
        }

        await pgPool.query(updateQuery, queryParams);
        
        res.json({ success: true, message: 'บันทึกข้อมูลและส่งตรวจสอบใหม่สำเร็จ' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error: ' + err.message });
    }
});
// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 1. API: ดึงข้อมูลสัตว์และตัวเลขทั้งหมด (GET)
// ==========================================
app.get('/api/admin/animal-numbers', async (req, res) => {
    try {
        const result = await pgPool.query(`
            SELECT * FROM Master_Animal_Numbers 
            ORDER BY created_at DESC
        `);
        
        // ส่งข้อมูล Array กลับไปให้หน้าเว็บ
        res.status(200).json(result.rows);

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
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API: เพิ่มข้อมูลสัตว์และตัวเลขใหม่ (POST)
// ==========================================
app.post('/api/admin/animal-numbers', async (req, res) => {
    const { animal_name_th, image_url, lottery_type, num1, num2, num3, is_active, action_by } = req.body;

    try {
        const checkQuery = await pgPool.query(
            `SELECT num1, num2, num3 FROM Master_Animal_Numbers WHERE lottery_type = $1`, 
            [lottery_type]
        );
        
        const existingNumbers = checkQuery.rows.flatMap(row => [row.num1, row.num2, row.num3]);
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
            ($1, $2, $3, $4, $5, $6, $7, $8)
        `;

        await pgPool.query(insertQuery, [
            animal_name_th, 
            image_url, 
            lottery_type, 
            num1, 
            num2, 
            num3, 
            is_active ? '1' : '0', 
            action_by || 'Unknown' // 🌟 เก็บชื่อคนทำ
        ]);

        res.status(201).json({ success: true, message: 'บันทึกข้อมูลสัตว์และตัวเลขสำเร็จ' });
    } catch (error) {
        console.error('SQL Server Error Details:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการ INSERT Database', error: error.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API: แก้ไขข้อมูลสัตว์และตัวเลข (PUT)
// ==========================================
app.put('/api/admin/animal-numbers/:id', async (req, res) => {
    const { id } = req.params;
    const { animal_name_th, image_url, lottery_type, num1, num2, num3, is_active, action_by } = req.body;

    try {
        // 🌟 ดักเลขซ้ำ (แต่ต้องยกเว้น ID ของตัวเองที่กำลังแก้อยู่)
        const checkQuery = await pgPool.query(
            `SELECT num1, num2, num3 FROM Master_Animal_Numbers WHERE lottery_type = $1 AND animal_id != $2`, 
            [lottery_type, id]
        );
        
        const existingNumbers = checkQuery.rows.flatMap(row => [row.num1, row.num2, row.num3]);
        const newNumbers = [num1, num2];
        if (num3 !== '-') newNumbers.push(num3);

        const duplicates = newNumbers.filter(n => existingNumbers.includes(n));
        
        if (duplicates.length > 0) {
            return res.status(400).json({ success: false, message: `เลข ${duplicates.join(', ')} ถูกใช้ไปแล้วในโหมด ${lottery_type} ตัว` });
        }

        const updateQuery = `
            UPDATE Master_Animal_Numbers 
            SET animal_name_th = $1,
                image_url = $2,
                lottery_type = $3,
                num1 = $4,
                num2 = $5,
                num3 = $6,
                is_active = $7,
                updated_by = $8
            WHERE animal_id = $9
        `;

        await pgPool.query(updateQuery, [
            animal_name_th, 
            image_url, 
            lottery_type, 
            num1, 
            num2, 
            num3, 
            is_active ? '1' : '0', 
            action_by || 'Unknown', 
            id
        ]);

        res.status(200).json({ success: true, message: 'แก้ไขข้อมูลสำเร็จ' });
    } catch (error) {
        console.error('SQL Server Error Details:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการ UPDATE Database', error: error.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API: สำหรับการซื้อหวย (ตัดเงิน/คำนวณวัน/จ่ายค่าคอม/แสตมป์ชื่อลูกทีม)
// ==========================================
app.post('/api/lottery/buy', async (req, res) => {
    // 🌟 อัปเกรด 1: รับค่า note เข้ามาจากฝั่งหน้าบ้าน
    const { user_id, cart, total_price, currency, note } = req.body;
    
    // ==========================================
    // 🌟 0. แทรกระบบเช็คสถานะการขาย
    // ==========================================
    const statusRes = await pgPool.query("SELECT is_sales_open FROM System_Settings WHERE id = 1");
    if (!statusRes.rows[0].is_sales_open || statusRes.rows[0].is_sales_open === '0') {
        return res.status(400).json({ success: false, message: 'ระบบปิดรับซื้อแล้วในขณะนี้ กรุณารอรอบถัดไป' });
    }

    const client = await pgPool.connect();

    try {
        await client.query('BEGIN'); // เริ่ม Transaction

        // 1. ดึงอัตราแลกเปลี่ยนมาเป็น "ตัวกลาง"
        let exchangeRate = 1;
        if (currency === 'LAK') {
            const rateRes = await client.query("SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'");
            if (rateRes.rows.length > 0) {
                exchangeRate = rateRes.rows[0].rate;
            }
        }

        // 2. แปลงยอดซื้อให้เป็น THB เพื่อใช้เป็นฐาน
        const baseTHBAmount = total_price / exchangeRate;

        // 3. คำนวณยอดที่จะหักเงิน (แปลงกลับเป็นสกุลเงินกระเป๋าลูกค้า)
        const deductAmount = baseTHBAmount * exchangeRate; 

        // 4. เช็คยอดเงินและหักเงินในกระเป๋า
        const userRes = await client.query('SELECT balance FROM Wallets WHERE user_id = $1', [user_id]); 

        if (userRes.rows.length === 0) throw new Error('ไม่พบข้อมูลกระเป๋าเงินในระบบ (กรุณาแจ้งแอดมินตรวจสอบ)');
        if (parseFloat(userRes.rows[0].balance) < deductAmount) { 
            throw new Error('ยอดเงินในกระเป๋าไม่เพียงพอ');
        }

        await client.query(`
            UPDATE Users SET wallet_balance = COALESCE(wallet_balance, 0) - $1 WHERE user_id = $2;
            UPDATE Wallets SET balance = balance - $1 WHERE user_id = $2;
        `, [deductAmount, user_id]);

        // 5. บันทึกประวัติ
        await client.query(`
            INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at)
            VALUES ($1, 'Buy Lottery', 'ซื้อหวยเวียดนาม', $2, 'Completed', CURRENT_TIMESTAMP)
        `, [user_id, -deductAmount]);

        // ==========================================
        // 🌟 แทรกระบบคำนวณ งวดวันที่ (draw_date) เข้าไปในบิล
        // (ประยุกต์ใช้เวลาของ Postgres แทน DECLARE แบบเดิม)
        // ==========================================
        const orderRes = await client.query(`
            INSERT INTO Lottery_Orders (user_id, total_amount, currency_code, status, draw_date, created_at, order_note)
            VALUES (
                $1, $2, $3, 'รอผลตรวจ', 
                CASE 
                    WHEN (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::time >= (SELECT close_time FROM System_Settings LIMIT 1)
                    THEN (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date + INTERVAL '1 day'
                    ELSE (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date
                END, 
                CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok', $4
            )
            RETURNING order_id
        `, [user_id, deductAmount, currency, note || null]);
        
        const orderId = orderRes.rows[0].order_id;

        // บันทึกรายการย่อย
        for (const item of cart) {
            await client.query(`
                INSERT INTO Lottery_Order_Items (order_id, lottery_type, selected_number, price, status)
                VALUES ($1, $2, $3, $4, 'รอผลตรวจ')
            `, [orderId, item.type, item.number, item.price]);
        }

        // ==========================================
        // 🌟 6. ระบบจ่ายค่าแนะนำ (ดึง % จาก Database, แสตมป์ชื่อลูกทีม และแปลงสกุลเงินอัตโนมัติ!)
        // ==========================================
        const referrerRes = await client.query(`
            SELECT u_referrer.user_id, u_buyer.username as buyer_username,
                   COALESCE(u_buyer.currency_code, 'THB') as buyer_currency,
                   COALESCE(u_referrer.currency_code, 'THB') as referrer_currency
            FROM Users u_buyer
            JOIN Users u_referrer ON u_buyer.referrer_username = u_referrer.username
            WHERE u_buyer.user_id = $1
        `, [user_id]);

        if (referrerRes.rows.length > 0) {
            const referrerId = referrerRes.rows[0].user_id;
            const buyerUsername = referrerRes.rows[0].buyer_username;
            const buyerCurrency = referrerRes.rows[0].buyer_currency;
            const referrerCurrency = referrerRes.rows[0].referrer_currency;
            
            const settingRes = await client.query("SELECT purchase_percent FROM Commission_Settings WHERE id = 1");
            const purchasePercent = settingRes.rows.length > 0 ? settingRes.rows[0].purchase_percent : 2.00; 
            
            // คำนวณค่าคอมตั้งต้น (ตามสกุลเงินที่ใช้ซื้อ)
            const rawCommission = deductAmount * (purchasePercent / 100); 
            let finalCommission = rawCommission;

            // 🌟 อัปเกรด 5: ระบบ Cross-Currency แปลงค่าคอมเข้ากระเป๋าผู้แนะนำ
            if (buyerCurrency !== referrerCurrency) {
                const pair = `${buyerCurrency}_${referrerCurrency}`; 
                
                const rateRes = await client.query(`SELECT rate FROM ExchangeRates WHERE currency_pair = $1`, [pair]);
                    
                if (rateRes.rows.length > 0) {
                    finalCommission = finalCommission * rateRes.rows[0].rate;
                } else {
                    const reversePair = `${referrerCurrency}_${buyerCurrency}`;
                    const reverseRateRes = await client.query(`SELECT rate FROM ExchangeRates WHERE currency_pair = $1`, [reversePair]);
                    
                    if (reverseRateRes.rows.length > 0) {
                        finalCommission = finalCommission / reverseRateRes.rows[0].rate;
                    }
                }
            }

            const transTitle = `รายได้ ${purchasePercent}% จากทีมงาน (${buyerUsername})`;
            
            await client.query(`
                UPDATE Wallets SET balance = balance + $1 WHERE user_id = $2;
                UPDATE Users SET total_purchase_comm = COALESCE(total_purchase_comm, 0) + $1 WHERE user_id = $2;
                INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at)
                VALUES ($2, 'Affiliate Purchase', $3, $1, 'Completed', CURRENT_TIMESTAMP);
            `, [finalCommission, referrerId, transTitle]);
        }

        await client.query('COMMIT');
        res.status(200).json({ success: true, message: 'ชำระเงินสำเร็จ', order_id: orderId });

    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ success: false, message: error.message || 'เกิดข้อผิดพลาดในการชำระเงิน' });
    } finally {
        client.release();
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว (ลบตัวซ้ำออกแล้ว)
// 🌟 API: ดึงอัตราจ่ายเงินรางวัลหวยไปแสดงที่หน้าสลิป
// ==========================================
app.get('/api/lottery/prize-rates', async (req, res) => {
    try {
        const result = await pgPool.query('SELECT * FROM Lottery_Prize_Rates ORDER BY CAST(lottery_type AS INTEGER) ASC');
        res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error fetching prize rates:', error);
        res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลอัตราจ่ายได้' });
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API: ดึงประวัติการซื้อหวยของ User (GET)
// ==========================================
app.get('/api/lottery/history/:userId', async (req, res) => {
    const userId = req.params.userId;
    try {
        // 1. ดึงหัวบิลทั้งหมดของ User นี้ เรียงจากใหม่ไปเก่า
        const orderRes = await pgPool.query(`
                SELECT order_id, total_amount, currency_code, status, created_at
                FROM Lottery_Orders
                WHERE user_id = $1
                ORDER BY created_at DESC
            `, [userId]
        );
            
        const orders = orderRes.rows;

        // 2. ดึงรายละเอียดเลขหวยแต่ละตัว มาผูกกับหัวบิล
        for (let order of orders) {
            const itemRes = await pgPool.query(`
                    SELECT item_id, lottery_type, selected_number, price, status
                    FROM Lottery_Order_Items
                    WHERE order_id = $1
                `, [order.order_id]
            );
            order.items = itemRes.rows;
        }

        res.status(200).json({ success: true, data: orders });
    } catch (error) {
        console.error('Error fetching lottery history:', error);
        res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลประวัติได้' });
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API: ดึงประวัติการเงินทั้งหมดของลูกค้า (Statement)
// ==========================================
app.get('/api/transactions/:userId', async (req, res) => {
    try {
        const result = await pgPool.query(`
                SELECT * FROM Transactions 
                WHERE user_id = $1 
                ORDER BY created_at DESC
            `, [req.params.userId]
        );
            
        res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error fetching transactions history:', error);
        res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลประวัติการเงินได้' });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// API 1: ลูกค้าแจ้งฝากเงิน (บันทึกเป็น Pending เสมอ + ดักบิลซ้อน)
// ==========================================
app.post('/api/deposit-submit', async (req, res) => {
  try {
    const { userId, bankName, accountNumber, currencyCode, amount, depositDate, depositTime, slipBase64 } = req.body;
    const cleanAmount = Math.round(parseFloat(amount) * 100) / 100; 
    const depositDatetime = `${depositDate} ${depositTime}`;

    // 🛡️ [ด่านหน้าสุด]: เช็คว่ามีบิลที่ "รอตรวจ" (Pending) หรือ "รอแก้ไข" (Rejected) ค้างอยู่ไหม?
    // Postgres คืนค่า COUNT เป็น String จึงต้อง CAST เป็น INTEGER เพื่อเช็คค่าตัวเลขอย่างปลอดภัย
    const checkActive = await pgPool.query(`
        SELECT CAST(COUNT(*) AS INTEGER) as "activeCount" 
        FROM Transactions_Deposit 
        WHERE user_id = $1 AND status IN ('Pending', 'Rejected')
    `, [userId]);

    // ถ้ามีบิลค้างอยู่เกิน 0 ให้เด้งออกทันที! ห้ามส่งคำขอใหม่เด็ดขาด
    if (checkActive.rows[0].activeCount > 0) {
        return res.status(400).json({ 
            success: false, 
            message: 'คุณมีรายการฝากเงินที่กำลังรอดำเนินการ หรือรอแก้ไขอยู่ กรุณาจัดการบิลเดิมให้เสร็จสิ้นก่อนทำรายการใหม่ครับ' 
        });
    }
    // ----------------------------------------

    // ดึง Username
    const userResult = await pgPool.query(`SELECT username FROM Users WHERE user_id = $1`, [userId]);
    let customerName = 'ไม่ระบุชื่อ'; 
    if (userResult.rows.length > 0) {
      customerName = userResult.rows[0].username;
    }

    // บันทึกคำขอฝากเงิน (สถานะจะเป็น Pending ตลอดไปจนกว่าแอดมินจะกดอนุมัติ)
    await pgPool.query(`
        INSERT INTO Transactions_Deposit (user_id, customer_name, bank_name, account_number, amount, currency_code, slip_image, status, deposit_datetime, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', $8, CURRENT_TIMESTAMP)
      `, 
      [userId, customerName, bankName || '', accountNumber || '', cleanAmount, currencyCode || 'THB', slipBase64, depositDatetime]
    );

    res.json({ success: true, message: 'ส่งคำขอฝากเงินสำเร็จ! รอแอดมินตรวจสอบสลิป' });
  } catch (error) {
    console.error('Error in deposit-submit:', error);
    res.status(500).json({ success: false, message: 'เซิร์ฟเวอร์ขัดข้อง: ' + error.message });
  }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// API: ดึงรายการแจ้งฝากเงิน + สรุปยอดรายเดือน (สำหรับ Admin)
// ==========================================
app.get('/api/admin/deposit-requests', async (req, res) => {
  try {
    // 🌟 แก้ไข: ดึงรายการรอตรวจทั้งหมด + ประวัติย้อนหลัง 7 วัน (รายการเมื่อวานจะได้ไม่หาย)
    const queryList = `
      SELECT 
        deposit_id, user_id, customer_name, bank_name, account_number, 
        amount, currency_code, slip_image, status, 
        to_char(deposit_datetime, 'YYYY-MM-DD"T"HH24:MI:SS') AS deposit_datetime, 
        to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS created_at, 
        reject_reasons, edit_count
      FROM Transactions_Deposit
      WHERE status IN ('Pending', 'Slip Verified') 
         OR CAST(created_at AS DATE) >= CAST(CURRENT_TIMESTAMP - INTERVAL '7 days' AS DATE)
      ORDER BY created_at DESC
    `;
    const resultList = await pgPool.query(queryList);

    // ใช้ EXTRACT() สำหรับหาเดือนและปีปัจจุบัน
    const querySummary = `
      SELECT t.currency_code, COALESCE(SUM(t.amount), 0) as total_amount
      FROM Transactions_Deposit t
      INNER JOIN Bank_Statements b ON t.deposit_id = b.reconciled_with_deposit_id
      WHERE t.status = 'Approved'
        AND EXTRACT(MONTH FROM t.created_at) = EXTRACT(MONTH FROM CURRENT_TIMESTAMP)
        AND EXTRACT(YEAR FROM t.created_at) = EXTRACT(YEAR FROM CURRENT_TIMESTAMP)
      GROUP BY t.currency_code
    `;
    const resultSummary = await pgPool.query(querySummary);
    
    const monthlySummary = {};
    resultSummary.rows.forEach(row => {
      monthlySummary[row.currency_code] = row.total_amount;
    });

    res.json({ success: true, requests: resultList.rows, summary: monthlySummary });

  } catch (error) {
    console.error('Error fetching deposit requests:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
  }
});
// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API: แอดมินตีกลับคำขอฝากเงิน (แก้ไขบั๊ก Error 500 เรียบร้อย)
// ==========================================
app.post('/api/admin/deposit-reject', async (req, res) => {
  try {
    const { depositId, userId, rejectReasons } = req.body;

    // แปลงเหตุผลเป็น JSON (ใส่กันเหนียวไว้เผื่อไม่มีค่าส่งมา)
    const reasonsJson = JSON.stringify(rejectReasons || []);

    // 1. อัปเดตสถานะเป็น ตีกลับ (Rejected) และบวก edit_count
    const updateResult = await pgPool.query(`
        UPDATE Transactions_Deposit 
        SET status = 'Rejected', 
            reviewed_by = 'Admin (Returned)', 
            reject_reasons = $1,
            edit_count = COALESCE(edit_count, 0) + 1
        WHERE deposit_id = $2
        RETURNING edit_count
      `, [reasonsJson, depositId]
    );
      
    const currentEditCount = updateResult.rows[0].edit_count;

    // 2. 🛡️ ระบบป้องกันก่อกวน: ถ้าลูกค้ารายเดิม ส่งแก้บิลเดิมผิดเกิน 3 ครั้ง ให้ยกเลิกถาวร!
    if (currentEditCount > 3) {
      await pgPool.query(`
          UPDATE Transactions_Deposit 
          SET status = 'Cancelled', 
              reviewed_by = 'System Blocked (Spam)' 
          WHERE deposit_id = $1
        `, [depositId]
      );
        
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
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// API: ลูกค้าแก้ไขคำขอที่ถูกตีกลับ แล้วส่งมาให้แอดมินตรวจใหม่
// ==========================================
app.put('/api/deposit-edit/:id', async (req, res) => {
  try {
    const depositId = req.params.id;
    const { amount, depositDate, depositTime, slipBase64 } = req.body;
    
    const depositDatetime = `${depositDate} ${depositTime}`;
    const cleanAmount = Math.round(parseFloat(amount) * 100) / 100;
    
    // 🌟 อัปเดตข้อมูลที่ลูกค้าแก้ เปลี่ยนสถานะเป็น Pending เพื่อกลับไปเข้าคิวให้แอดมินตรวจ
    await pgPool.query(`
        UPDATE Transactions_Deposit
        SET amount = $1,
            deposit_datetime = $2,
            slip_image = $3,
            status = 'Pending', 
            reviewed_by = 'User Updated',
            reject_reasons = NULL
        WHERE deposit_id = $4
      `, [cleanAmount, depositDatetime, slipBase64, depositId]
    );
      
    res.json({ success: true, message: 'ส่งคำขอที่แก้ไขแล้วเรียบร้อย กรุณารอแอดมินตรวจสอบ' });
  } catch(error) {
    console.error('Error updating deposit:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูลแก้ไข' });
  }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// API: ดึงรายชื่อธนาคารสำหรับ Dropdown
// ==========================================
app.get('/api/admin/banks', async (req, res) => {
  try {
    const result = await pgPool.query("SELECT * FROM Banks WHERE is_active = '1'");
    res.json({ success: true, banks: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลธนาคารได้' });
  }
});



// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// API 1: ลูกค้าแจ้งฝากเงิน (อัปเดตค้นหาว่าแอดมินคีย์ยอดรอไว้แล้วหรือยัง)
// ==========================================
app.post('/api/deposit-submit', async (req, res) => {
  const client = await pgPool.connect(); // 🌟 ใช้ Transaction เผื่อกรณีคีย์ตรงกันแล้วต้องอัปเดตเงิน

  try {
    const { userId, bankName, accountNumber, currencyCode, amount, depositDate, depositTime, slipBase64 } = req.body;
    const cleanAmount = Math.round(parseFloat(amount) * 100) / 100; 
    const depositDatetime = `${depositDate} ${depositTime}`;
    
    await client.query('BEGIN'); // เริ่มล็อคฐานข้อมูล

    // ดึงชื่อลูกค้า
    const nameResult = await client.query(`SELECT firstname, lastname FROM UserName_Lastname WHERE user_id = $1`, [userId]);
    let fullName = 'ผู้ใช้ทั่วไป'; 
    if (nameResult.rows.length > 0) {
      fullName = `${nameResult.rows[0].firstname} ${nameResult.rows[0].lastname}`; 
    }

    // บันทึกคำขอฝากเงินของลูกค้า (สถานะเริ่มต้นคือ Pending)
    const insertResult = await client.query(`
        INSERT INTO Transactions_Deposit (user_id, customer_name, bank_name, account_number, amount, currency_code, slip_image, status, deposit_datetime, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', $8, CURRENT_TIMESTAMP)
        RETURNING deposit_id
      `, 
      [userId, fullName, bankName || '', accountNumber || '', cleanAmount, currencyCode || 'THB', slipBase64, depositDatetime]
    );

    const newDepositId = insertResult.rows[0].deposit_id;

    // 🌟 1.1 ตรวจสอบว่า "แอดมินได้คีย์ยอดนี้รอไว้ในระบบแล้วหรือยัง?"
    const findAdminStatement = await client.query(`
        SELECT statement_id FROM Bank_Statements
        WHERE is_reconciled = '0'
          AND account_number = $1
          AND ABS(amount - $2) <= 0.01
          AND CAST(transfer_date AS DATE) = CAST($3 AS DATE)
          AND CAST(transfer_time AS TIME) = CAST($4 AS TIME)
        LIMIT 1
      `, [accountNumber, cleanAmount, depositDate, depositTime]
    );

    if (findAdminStatement.rows.length > 0) {
      // 🌟 เจอที่แอดมินคีย์รอไว้! -> อนุมัติและเติมเงินทันที
      const stmtId = findAdminStatement.rows[0].statement_id;

      await client.query("UPDATE Transactions_Deposit SET status = 'Approved', reviewed_by = 'Auto-Reconciled' WHERE deposit_id = $1", [newDepositId]);

      await client.query("UPDATE Wallets SET balance = COALESCE(balance, 0) + $1, last_updated = CURRENT_TIMESTAMP WHERE user_id = $2", [cleanAmount, userId]);

      await client.query("INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at) VALUES ($1, 'Deposit', 'ฝากเงิน (อัตโนมัติ)', $2, 'Completed', CURRENT_TIMESTAMP)", [userId, cleanAmount]);

      await client.query("UPDATE Bank_Statements SET is_reconciled = '1', reconciled_with_deposit_id = $1 WHERE statement_id = $2", [newDepositId, stmtId]);
    }

    await client.query('COMMIT'); // ยืนยันข้อมูลทั้งหมดลง Database
    res.json({ success: true, message: 'ส่งคำขอฝากเงินสำเร็จ!' });

  } catch (error) {
    await client.query('ROLLBACK'); // ยกเลิกหากเกิดปัญหา
    console.error('Error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล' });
  } finally {
    client.release(); // คืน Connection
  }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🚀 THE FUTURE RECONCILIATION ENGINE (ระบบกระทบยอดอัตโนมัติ 2 ทาง)
// API: แอดมินกด "ตรวจสอบสลิปผ่าน"
// ==========================================
app.post('/api/admin/deposit-approve', async (req, res) => {
  const { depositId, userId, amount } = req.body;

  const client = await pgPool.connect(); // 🌟 ใช้ Transaction

  try {
    await client.query('BEGIN');

    // 1. ดึงข้อมูลคำขอฝากเงินขึ้นมา
    const depositRes = await client.query(`
        SELECT amount, deposit_datetime, account_number, bank_name, currency_code 
        FROM Transactions_Deposit 
        WHERE deposit_id = $1
      `, [depositId]
    );
      
    if (depositRes.rows.length === 0) throw new Error('ไม่พบข้อมูลคำขอฝากเงิน');
    const depositData = depositRes.rows[0];

    // 2. เปลี่ยนสถานะคำขอฝากเป็น 'Slip Verified' 
    await client.query(`
        UPDATE Transactions_Deposit 
        SET status = 'Slip Verified', reviewed_by = 'Admin' 
        WHERE deposit_id = $1
      `, [depositId]
    );

    // 3. วิ่งไปค้นหายอดเงินเข้า (Bank_Statements) 
    const matchRes = await client.query(`
        SELECT statement_id 
        FROM Bank_Statements 
        WHERE (is_reconciled = '0' OR is_reconciled IS NULL) 
          AND amount = $1 
          AND account_number = $2
          AND transfer_date = CAST($3 AS DATE)
        LIMIT 1
      `, [depositData.amount, depositData.account_number || '', depositData.deposit_datetime]
    );

    // 4. กรณีที่ 1: พบยอดเงินที่ตรงกัน! (กระทบยอดสำเร็จทันที)
    if (matchRes.rows.length > 0) {
      const matchedStatementId = matchRes.rows[0].statement_id;

      // 4.1 อัปเดตสถานะทั้ง 2 ฝั่งให้เป็น 'สำเร็จ'
      await client.query(`UPDATE Transactions_Deposit SET status = 'Approved' WHERE deposit_id = $1`, [depositId]);
      await client.query(`UPDATE Bank_Statements SET is_reconciled = '1', reconciled_with_deposit_id = $1 WHERE statement_id = $2`, [depositId, matchedStatementId]);

      // 4.2 เติมเงินเข้า Wallet ลูกค้า
      await client.query(`UPDATE Wallets SET balance = COALESCE(balance, 0) + $1, last_updated = CURRENT_TIMESTAMP WHERE user_id = $2`, [amount, userId]);

      // 4.3 บันทึกประวัติการเงิน (Transaction Log)
      await client.query(`
          INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at) 
          VALUES ($1, 'Deposit', 'ระบบกระทบยอดเงินฝากอัตโนมัติ', $2, 'Completed', CURRENT_TIMESTAMP)
        `, [userId, amount]
      );

      await client.query('COMMIT');
      res.json({ success: true, message: 'สลิปถูกต้อง และระบบชนยอดอัตโนมัติสำเร็จ! (เงินเข้าลูกค้าแล้ว)' });
      
    } 
    // 5. กรณีที่ 2: ยังไม่มียอดเงินตรงกันเข้ามา (ให้ค้างสถานะรอฝั่งบัญชีคีย์ยอด)
    else {
      await client.query('COMMIT');
      res.json({ success: true, message: 'สลิปถูกต้องแล้ว (กำลังรอฝั่งบัญชีเงินเข้าคีย์ยอดเพื่อชนยอดอัตโนมัติ)' });
    }

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Auto Reconciliation Connection Error:', error);
    res.status(500).json({ success: false, message: 'ไม่สามารถเชื่อมต่อฐานข้อมูล หรือเกิดข้อผิดพลาด: ' + error.message });
  } finally {
    client.release();
  }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API 1: ดึงประวัติการฝากเงินของลูกค้า (เพื่อเช็คยอดตีกลับและแจ้งเตือน)
// ==========================================
app.get('/api/user/deposits/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await pgPool.query(`
        SELECT deposit_id, amount, deposit_datetime, slip_image, status, reject_reasons, account_number, bank_name
        FROM Transactions_Deposit 
        WHERE user_id = $1 
        ORDER BY created_at DESC
      `, [userId]
    );
    
    // ส่งข้อมูลกลับไปให้หน้าบ้าน
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching user deposits:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API 2: สำหรับลูกค้ารับส่งข้อมูลที่ "แก้ไขแล้ว" กลับไปให้แอดมิน
// ==========================================
app.put('/api/deposit-edit/:depositId', async (req, res) => {
  const { depositId } = req.params;
  const { amount, depositDate, depositTime, slipBase64 } = req.body;
  
  // 🌟 [แก้บั๊กเวลาเพี้ยน]
  let timeStr = depositTime;
  if (timeStr.length === 5) timeStr += ':00'; 
  
  const depositDatetime = `${depositDate} ${timeStr}`; 

  try {
    if (slipBase64) {
      await pgPool.query(`
          UPDATE Transactions_Deposit 
          SET amount = $1, 
              deposit_datetime = $2, 
              slip_image = $3,
              status = 'Pending', 
              reject_reasons = NULL,
              edit_count = COALESCE(edit_count, 0) + 1
          WHERE deposit_id = $4
        `, [amount, depositDatetime, slipBase64, depositId]
      );
    } else {
      await pgPool.query(`
          UPDATE Transactions_Deposit 
          SET amount = $1, 
              deposit_datetime = $2, 
              status = 'Pending', 
              reject_reasons = NULL,
              edit_count = COALESCE(edit_count, 0) + 1
          WHERE deposit_id = $3
        `, [amount, depositDatetime, depositId]
      );
    }

    res.json({ success: true, message: 'ส่งข้อมูลแก้ไขเรียบร้อยแล้ว แอดมินจะรีบตรวจสอบอีกครั้งครับ' });
  } catch (error) {
    console.error('Error updating deposit:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูลแก้ไข' });
  }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
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
    
    // 🌟 1. บันทึกยอดที่ฝั่งบัญชีคีย์เข้ามา
    const insertStmt = await pgPool.query(`
        INSERT INTO Bank_Statements (bank_id, bank_name, account_number, amount, transfer_date, transfer_time, recorded_by, is_reconciled)
        VALUES ($1, $2, $3, $4, CAST($5 AS DATE), CAST($6 AS TIME), $7, '0')
        RETURNING statement_id
      `, [bankId, bankName, accountNumber, cleanAmount, transferDate, cleanTime, adminName]
    );
    const statementId = insertStmt.rows[0].statement_id;

    // 2. 🌟 ค้นหาและจับคู่สลิปแบบฉลาด (Smart Match) แปลงสมการหาค่าความต่างของเวลาให้เข้ากับ Postgres
    const findSlip = await pgPool.query(`
        SELECT deposit_id, user_id FROM Transactions_Deposit 
        WHERE status = 'Slip Verified' 
          -- 🌟 ตัดขีดกลางและช่องว่างก่อนเทียบเลขบัญชี
          AND REPLACE(REPLACE(account_number, '-', ''), ' ', '') = REPLACE(REPLACE($1, '-', ''), ' ', '')
          -- 🌟 ยอดเงินต้องตรงกันเป๊ะ
          AND ABS(amount - $2) <= 0.01
          -- 🌟 วันที่โอนต้องตรงกัน
          AND CAST(deposit_datetime AS DATE) = CAST($3 AS DATE)
          -- 🌟 อนุโลมเวลาคลาดเคลื่อนได้ไม่เกิน +/- 10 นาที (แปลงเวลาเป็นวินาทีหาร 60 = นาที)
          AND ABS(EXTRACT(EPOCH FROM (CAST(deposit_datetime AS TIME) - CAST($4 AS TIME))) / 60) <= 10
        -- 🌟 เรียงลำดับเอาบิลที่เวลาใกล้เคียงที่สุดขึ้นมาก่อน
        ORDER BY ABS(EXTRACT(EPOCH FROM (CAST(deposit_datetime AS TIME) - CAST($4 AS TIME)))) ASC
        LIMIT 1
      `, [accountNumber, cleanAmount, transferDate, cleanTime]
    );

    // 3. ถ้าเจอบิลที่ตรงกัน ให้ประมวลผลแจกเงินเข้า Wallet ทันที!
    if (findSlip.rows.length > 0) {
      const match = findSlip.rows[0];

      // ใช้ Transaction ยืนยันการจ่ายเงินอย่างปลอดภัย
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        
        await client.query("UPDATE Transactions_Deposit SET status = 'Approved', reviewed_by = 'Bank (Matched)' WHERE deposit_id = $1", [match.deposit_id]);
        
        await client.query("UPDATE Wallets SET balance = COALESCE(balance, 0) + $1, last_updated = CURRENT_TIMESTAMP WHERE user_id = $2", [cleanAmount, match.user_id]);

        await client.query("INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at) VALUES ($1, 'Deposit', 'ฝากเงิน (สำเร็จ)', $2, 'Completed', CURRENT_TIMESTAMP)", [match.user_id, cleanAmount]);

        await client.query("UPDATE Bank_Statements SET is_reconciled = '1', reconciled_with_deposit_id = $1 WHERE statement_id = $2", [match.deposit_id, statementId]);

        await client.query('COMMIT');
        return res.json({ success: true, message: 'คีย์ยอดสำเร็จ และระบบจับคู่ให้อัตโนมัติ! (เติมเงินเข้า Wallet ให้ลูกค้าแล้ว)' });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // 4. ถ้าไม่เจอ ให้ติดสถานะ "รอกระทบยอด" ไว้ก่อน
    res.json({ success: true, message: 'บันทึกยอดเข้าธนาคารสำเร็จ (แต่ไม่พบบิลจากลูกค้าที่ตรงกัน ระบบรอจับคู่อีกครั้ง)' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: 'ระบบขัดข้อง: ' + error.message });
  }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// API: บัญชีแก้ไขรายการคีย์ยอด (อัปเดต + ค้นหาจับคู่แบบฉลาด 🌟)
// ==========================================
app.put('/api/admin/key-statement/:id', async (req, res) => {
  const client = await pgPool.connect(); // 🌟 ใช้ Transaction ครอบทั้งกระบวนการ

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

    await client.query('BEGIN'); // เริ่ม Transaction

    // 1. อัปเดตข้อมูลในตาราง Bank_Statements
    await client.query(`
        UPDATE Bank_Statements 
        SET bank_id = $1, bank_name = $2, account_number = $3, 
            amount = $4, transfer_date = CAST($5 AS DATE), 
            transfer_time = CAST($6 AS TIME), recorded_by = $7
        WHERE statement_id = $8 AND is_reconciled = '0'
      `, [bankId, bankName, accountNumber, cleanAmount, transferDate, cleanTime, adminName, statementId]
    );

    // 2. 🌟 ค้นหาและจับคู่สลิปแบบฉลาด (Smart Match) อีกรอบหลังจากแก้ข้อมูล
    const findSlip = await client.query(`
        SELECT deposit_id, user_id FROM Transactions_Deposit 
        WHERE status = 'Slip Verified' 
          AND REPLACE(REPLACE(account_number, '-', ''), ' ', '') = REPLACE(REPLACE($1, '-', ''), ' ', '')
          AND ABS(amount - $2) <= 0.01
          AND CAST(deposit_datetime AS DATE) = CAST($3 AS DATE)
          AND ABS(EXTRACT(EPOCH FROM (CAST(deposit_datetime AS TIME) - CAST($4 AS TIME))) / 60) <= 10
        ORDER BY ABS(EXTRACT(EPOCH FROM (CAST(deposit_datetime AS TIME) - CAST($4 AS TIME)))) ASC
        LIMIT 1
      `, [accountNumber, cleanAmount, transferDate, cleanTime]
    );

    // 3. ถ้าเจอสลิปที่ตรงกัน ให้ประมวลผลแจกเงิน!
    if (findSlip.rows.length > 0) {
      const match = findSlip.rows[0];

      await client.query("UPDATE Transactions_Deposit SET status = 'Approved', reviewed_by = 'Bank (Matched)' WHERE deposit_id = $1", [match.deposit_id]);
      
      await client.query("UPDATE Wallets SET balance = COALESCE(balance, 0) + $1, last_updated = CURRENT_TIMESTAMP WHERE user_id = $2", [cleanAmount, match.user_id]);

      await client.query("INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at) VALUES ($1, 'Deposit', 'ฝากเงิน (สำเร็จ)', $2, 'Completed', CURRENT_TIMESTAMP)", [match.user_id, cleanAmount]);

      await client.query("UPDATE Bank_Statements SET is_reconciled = '1', reconciled_with_deposit_id = $1 WHERE statement_id = $2", [match.deposit_id, statementId]);

      await client.query('COMMIT');
      return res.json({ success: true, message: 'อัปเดตข้อมูลสำเร็จ และระบบจับคู่ให้อัตโนมัติ! (เติมเงินให้ลูกค้าแล้ว)' });
    }

    await client.query('COMMIT');
    res.json({ success: true, message: 'อัปเดตข้อมูลสำเร็จ (แต่ยังไม่พบบิลจากลูกค้าที่ตรงกัน รอการจับคู่)' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error:', error);
    res.status(500).json({ success: false, message: 'ระบบขัดข้อง: ' + error.message });
  } finally {
    client.release();
  }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// API: บัญชีคีย์ยอดโอนเข้า + กระทบยอด + แปลงสกุลเงินอัตโนมัติ (เวอร์ชันสมบูรณ์)
// ==========================================
app.post('/api/admin/key-statement', async (req, res) => {
  const client = await pgPool.connect(); // 🌟 เริ่ม Transaction

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

    await client.query('BEGIN'); // เริ่มล็อก DB

    // 2. บันทึกยอดที่บัญชีคีย์ลงระบบ Bank_Statements (is_reconciled = 0 คือรอกระทบยอด)
    const insertStmt = await client.query(`
        INSERT INTO Bank_Statements (bank_id, bank_name, account_number, amount, transfer_date, transfer_time, recorded_by, is_reconciled)
        VALUES ($1, $2, $3, $4, CAST($5 AS DATE), CAST($6 AS TIME), $7, '0')
        RETURNING statement_id
      `, [bankId, bankName, accountNumber, cleanAmount, transferDate, cleanTime, adminName]
    );
    const statementId = insertStmt.rows[0].statement_id;

    // 3. 🌟 ค้นหา "กุญแจดอกที่ 1" (หาสลิปที่แอดมินเพิ่งกดตรวจผ่าน 'Slip Verified' รออยู่)
    const findSlip = await client.query(`
        SELECT deposit_id, user_id 
        FROM Transactions_Deposit 
        WHERE (status = 'Slip Verified' OR (status = 'Pending' AND reviewed_by = 'Slip Verified'))
          AND account_number = $1 AND ABS(amount - $2) <= 0.01
          AND CAST(deposit_datetime AS DATE) = CAST($3 AS DATE)
          AND CAST(deposit_datetime AS TIME) = CAST($4 AS TIME)
        LIMIT 1
      `, [accountNumber, cleanAmount, transferDate, cleanTime]
    );

    if (findSlip.rows.length > 0) {
      // 🟢 กรณีที่ 1: แอดมินตรวจสลิปแล้ว + บัญชีเพิ่งมาคีย์ยอด (กุญแจ 2 ดอกตรงกัน!) -> จ่ายเงินได้!
      const match = findSlip.rows[0];
      const userId = match.user_id;

      // 🌟 ระบบแปลงค่าเงิน: เช็คก่อนว่าลูกค้าคนนี้ใช้กระเป๋าเงินสกุลอะไร?
      const userProfile = await client.query("SELECT currency_code FROM User_Profile_Banks WHERE user_id = $1", [userId]);
      
      let userCurrency = 'THB';
      if (userProfile.rows.length > 0) {
         userCurrency = userProfile.rows[0].currency_code;
      }

      let finalAmountToWallet = cleanAmount;

      // 🌟 ถ้าลูกค้าใช้เงินกีบ (LAK) ให้ดึงเรทแลกเปลี่ยนมาคูณยอดเงินก่อนเข้ากระเป๋า
      if (userCurrency === 'LAK') {
         const rateResult = await client.query("SELECT exchange_rate FROM ExchangeRates WHERE currency_from = 'THB' AND currency_to = 'LAK' ORDER BY updated_at DESC LIMIT 1");
         let exchangeRate = 500; // ค่าเรทสำรองกันพลาด
         if (rateResult.rows.length > 0 && rateResult.rows[0].exchange_rate > 0) {
            exchangeRate = rateResult.rows[0].exchange_rate;
         }
         finalAmountToWallet = cleanAmount * exchangeRate;
      }

      // 3.1 อัปเดตสถานะสลิปว่า Approved
      await client.query("UPDATE Transactions_Deposit SET status = 'Approved', reviewed_by = 'Bank (Matched)' WHERE deposit_id = $1", [match.deposit_id]);
      
      // 3.2 🌟 เติมเงินเข้ากระเป๋า (ใช้ finalAmountToWallet ที่ผ่านการแปลงค่าเงินแล้ว)
      await client.query("UPDATE Wallets SET balance = COALESCE(balance, 0) + $1, last_updated = CURRENT_TIMESTAMP WHERE user_id = $2", [finalAmountToWallet, userId]);
      
      // (ถ้าคุณพี่ใช้ตาราง User_Profile_Banks เก็บยอดเงินด้วย ให้อัปเดตตารางนี้ด้วยครับ)
      await client.query("UPDATE User_Profile_Banks SET wallet_balance = COALESCE(wallet_balance, 0) + $1 WHERE user_id = $2", [finalAmountToWallet, userId]);

      // 3.3 บันทึกประวัติ Transaction ลูกค้า (บันทึกเป็นยอดเงินปลายทาง)
      const txTitle = userCurrency === 'LAK' ? 'ฝากเงิน (สำเร็จ - แปลงจาก THB)' : 'ฝากเงิน (สำเร็จ)';
      await client.query(`
          INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at) 
          VALUES ($1, 'Deposit', $2, $3, 'Completed', CURRENT_TIMESTAMP)
        `, [userId, txTitle, finalAmountToWallet]
      );

      // 3.4 🌟 อัปเดตตารางคีย์ยอด (Bank_Statements) ว่า "กระทบยอดสำเร็จแล้ว"
      await client.query("UPDATE Bank_Statements SET is_reconciled = '1', reconciled_with_deposit_id = $1 WHERE statement_id = $2", [match.deposit_id, statementId]);

      await client.query('COMMIT');
      return res.json({ success: true, message: `คีย์ยอดสำเร็จและจับคู่แล้ว! (เข้ากระเป๋าลูกค้า ${finalAmountToWallet.toLocaleString()} ${userCurrency})` });
    }

    // 🟡 กรณีที่ 2: บัญชีคีย์ยอดก่อน (แอดมินยังไม่กดตรวจสลิป) -> is_reconciled จะเป็น 0 ต่อไป
    await client.query('COMMIT');
    res.json({ success: true, message: 'บันทึกยอดเงินเข้าธนาคารสำเร็จ (รอแอดมินตรวจรูปสลิป ระบบถึงจะจ่ายเงิน)' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error Key Statement:', error);
    res.status(500).json({ success: false, message: 'ระบบขัดข้อง: ' + error.message });
  } finally {
    client.release();
  }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// API 3: รายงานสรุป (แยกยอดเงินรับ ตามบัญชีธนาคาร 100%)
// ==========================================
app.get('/api/admin/statement-report', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // 🌟 คิวรี่ 1: ดึงรายการประวัติ (อัปเกรดเป็น Parameter Query ป้องกันถูกเจาะระบบ)
    let query = `
      SELECT bs.*, to_char(bs.transfer_time, 'HH24:MI:SS') AS time_formatted, COALESCE(bk.currency, 'THB') AS currency
      FROM Bank_Statements bs LEFT JOIN Banks bk ON bs.bank_id = bk.bank_id
      WHERE 1=1
    `;
    
    let queryParams = [];
    if (startDate && endDate) {
      query += ` AND bs.transfer_date >= CAST($1 AS DATE) AND bs.transfer_date <= CAST($2 AS DATE)`;
      queryParams.push(startDate, endDate);
    }
    
    query += " ORDER BY bs.created_at DESC";
    const records = await pgPool.query(query, queryParams);

    // 🌟 คิวรี่ 2: จัดกลุ่มแยกตาม "ชื่อธนาคาร และ เลขบัญชี" (ปรับการใช้ฟังก์ชันเวลาให้เป็น Postgres)
    // ใช้ Double Quotes ครอบชื่อคอลัมน์ที่เป็น CamelCase ("todayTotal", "monthlyTotal") เพื่อให้ส่งไป React ได้เป๊ะตามเดิม
    const summaryQuery = `
      SELECT 
        bk.bank_name,
        bk.account_number,
        COALESCE(bk.currency, 'THB') AS currency,
        COALESCE(SUM(CASE WHEN CAST(bs.transfer_date AS DATE) = CAST(CURRENT_TIMESTAMP AS DATE) THEN bs.amount ELSE 0 END), 0) AS "todayTotal",
        COALESCE(SUM(CASE WHEN EXTRACT(MONTH FROM bs.transfer_date) = EXTRACT(MONTH FROM CURRENT_TIMESTAMP) AND EXTRACT(YEAR FROM bs.transfer_date) = EXTRACT(YEAR FROM CURRENT_TIMESTAMP) THEN bs.amount ELSE 0 END), 0) AS "monthlyTotal"
      FROM Bank_Statements bs
      LEFT JOIN Banks bk ON bs.bank_id = bk.bank_id
      GROUP BY bk.bank_name, bk.account_number, bk.currency
    `;
    const summaryRecords = await pgPool.query(summaryQuery);

    res.json({ success: true, records: records.rows, summary: summaryRecords.rows });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงรายงานได้' });
  }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// API: ดึงรายชื่อธนาคารสำหรับ Dropdown
// ==========================================
app.get('/api/admin/banks', async (req, res) => {
  try {
    const result = await pgPool.query("SELECT * FROM Banks WHERE is_active = '1'");
    res.json({ success: true, banks: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลธนาคารได้' });
  }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// API ตัวที่ 1: คีย์ยอดเงินเข้า และ กระทบยอดอัตโนมัติ (Auto-Reconciliation)
// ==========================================
app.post('/api/admin/key-statement', async (req, res) => {
  const client = await pgPool.connect(); // 🌟 ใช้ Transaction ครอบการทำงาน

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

    await client.query('BEGIN'); // เริ่มล็อกฐานข้อมูล

    // 2. บันทึกข้อมูลลง Bank_Statements โดยใช้ sql.VarChar แล้ว CAST ใน SQL ป้องกันเบราว์เซอร์ส่ง Data Type เพี้ยน
    const insertStmt = await client.query(`
        INSERT INTO Bank_Statements (bank_id, bank_name, account_number, amount, transfer_date, transfer_time, recorded_by, is_reconciled)
        VALUES ($1, $2, $3, $4, CAST($5 AS DATE), CAST($6 AS TIME), $7, '0')
        RETURNING statement_id
      `, [bankId, bankName, accountNumber, cleanAmount, transferDate, cleanTime, adminName]
    );
      
    const statementId = insertStmt.rows[0].statement_id;

    // 3. ค้นหาคำขอที่รอตรวจสอบ (ยอมรับความคลาดเคลื่อนได้ 0.01 บาท)
    const findMatch = await client.query(`
        SELECT deposit_id, user_id 
        FROM Transactions_Deposit
        WHERE status = 'Pending' 
          AND account_number = $1
          AND ABS(amount - $2) <= 0.01 
          AND CAST(deposit_datetime AS DATE) = CAST($3 AS DATE)
          AND CAST(deposit_datetime AS TIME) = CAST($4 AS TIME)
        LIMIT 1
      `, [accountNumber, cleanAmount, transferDate, cleanTime]
    );

    // 4. ถ้าเจอคู่ที่ตรงกัน ทำการอนุมัติ โอนเข้า Wallets และสร้าง Transactions
    if (findMatch.rows.length > 0) {
      const match = findMatch.rows[0];
      
      // อัปเดตสถานะบิล
      await client.query("UPDATE Transactions_Deposit SET status = 'Approved', reviewed_by = 'Auto-Reconciled' WHERE deposit_id = $1", [match.deposit_id]);
        
      // เติมเงินเข้าตาราง Wallets
      await client.query("UPDATE Wallets SET balance = COALESCE(balance, 0) + $1, last_updated = CURRENT_TIMESTAMP WHERE user_id = $2", [cleanAmount, match.user_id]);

      // บันทึกประวัติในตาราง Transactions พร้อม title
      await client.query(`
          INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at) 
          VALUES ($1, 'Deposit', 'ฝากเงิน (อัตโนมัติ)', $2, 'Completed', CURRENT_TIMESTAMP)
        `, [match.user_id, cleanAmount]
      );

      // อัปเดต Bank_Statements ว่าจับคู่สำเร็จแล้ว
      await client.query("UPDATE Bank_Statements SET is_reconciled = '1', reconciled_with_deposit_id = $1 WHERE statement_id = $2", [match.deposit_id, statementId]);

      await client.query('COMMIT'); // ยืนยันข้อมูล
      return res.json({ success: true, message: 'คีย์ยอดและกระทบยอดสำเร็จ! อนุมัติเงินเข้ากระเป๋าลูกค้าแล้ว', autoMatched: true });
    }

    await client.query('COMMIT'); // ยืนยันข้อมูลเฉพาะ Statement ถ้าหาไม่เจอ
    res.json({ success: true, message: 'บันทึกยอดเงินสำเร็จ (ยังไม่พบคำขอที่ตรงกัน รอระบบตรวจสอบภายหลัง)', autoMatched: false });

  } catch (error) {
    await client.query('ROLLBACK'); // ยกเลิกการบันทึกถ้าพังกลางคัน
    console.error('❌ Error in key-statement:', error);
    res.status(500).json({ success: false, message: 'ระบบขัดข้อง: ' + error.message });
  } finally {
    client.release();
  }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// API: ดึงรายงานสรุปและประวัติการคีย์ยอด
// ==========================================
app.get('/api/admin/statement-report', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // ดึงประวัติที่กรองตามช่วงวันที่ (ปรับใช้ Parameter ป้องกัน SQL Injection)
    let query = "SELECT * FROM Bank_Statements WHERE 1=1";
    let queryParams = [];

    if (startDate && endDate) {
      query += ` AND transfer_date >= CAST($1 AS DATE) AND transfer_date <= CAST($2 AS DATE)`;
      queryParams.push(startDate, endDate);
    }
    query += " ORDER BY created_at DESC";
    
    const records = await pgPool.query(query, queryParams);

    // 🌟 คำนวณสรุปยอดวันนี้ และเดือนนี้ (ใช้คำสั่งเวลาของ Postgres และคงตัวพิมพ์ใหญ่ใน JSON)
    const summary = await pgPool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN CAST(created_at AS DATE) = CAST(CURRENT_TIMESTAMP AS DATE) THEN amount ELSE 0 END), 0) AS "todayTotal",
        COALESCE(SUM(CASE WHEN EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_TIMESTAMP) AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_TIMESTAMP) THEN amount ELSE 0 END), 0) AS "monthlyTotal"
      FROM Bank_Statements
    `);

    res.json({ 
      success: true, 
      records: records.rows, 
      todayTotal: summary.rows[0].todayTotal,
      monthlyTotal: summary.rows[0].monthlyTotal
    });
  } catch (error) {
    console.error('Error fetching statement report:', error);
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงรายงานได้' });
  }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API 1: ดึงประวัติการฝากเงินของลูกค้า (เพื่อเช็คยอดตีกลับและแจ้งเตือน)
// ==========================================
app.get('/api/user/deposits/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await pgPool.query(`
        SELECT 
          deposit_id, amount, deposit_datetime, slip_image, status, reject_reasons, account_number, bank_name,
          -- 🌟 สั่ง SQL ให้หั่นวันที่และเวลาเป็นข้อความ (String) ด้วย to_char ป้องกันเวลาเพี้ยน +7
          to_char(deposit_datetime, 'YYYY-MM-DD') AS edit_date,
          to_char(deposit_datetime, 'HH24:MI:SS') AS edit_time
        FROM Transactions_Deposit 
        WHERE user_id = $1 
        ORDER BY created_at DESC
      `, [userId]
    );
    
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching user deposits:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว (ลบตัวซ้ำออกให้แล้วครับ)
// 🌟 API: ดึงข้อมูลทีมงานและรายได้ (อัปเดต 3 รายได้)
// ==========================================
app.get('/api/team/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const teamRes = await pgPool.query(`
        SELECT 
          user_id as id,
          username as name, 
          'https://ui-avatars.com/api/?name=' || username || '&background=random' as avatar,
          to_char(created_at, 'DD/MM/YYYY') as "joinDate", 
          
          -- ดึงรายได้ 3 ช่องทาง
          COALESCE(total_purchase_comm, 0) as "purchaseComm",
          COALESCE(total_win_comm, 0) as "winComm",
          COALESCE(total_daily_bonus, 0) as "dailyBonus",
          
          CASE WHEN (CURRENT_TIMESTAMP - created_at) < INTERVAL '30 days' THEN 1 ELSE 0 END as "isActive"
        FROM Users
        WHERE referrer_username = (SELECT username FROM Users WHERE user_id = $1 LIMIT 1)
        ORDER BY created_at DESC
      `, [userId]
    );
      
    const teamMembers = teamRes.rows || [];
    
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
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🚀 Cron Job: แจกโบนัสทีมรายวัน (รันอัตโนมัติทุกวันเวลา 05:00 น.)
// ==========================================
cron.schedule('0 5 * * *', async () => {
    const client = await pgPool.connect(); // 🌟 ใช้ Transaction ครอบการแจกโบนัส

    try {
        console.log('⏰ [5:00 AM] กำลังคำนวณและแจกโบนัสรายวันให้ผู้แนะนำ...');
        await client.query('BEGIN');

        // 0. ดึงเรทเปอร์เซ็นต์โบนัสรายวันมาก่อน
        const percentRes = await client.query("SELECT daily_bonus_percent FROM Commission_Settings LIMIT 1");
        const dailyPercent = percentRes.rows.length > 0 ? parseFloat(percentRes.rows[0].daily_bonus_percent) : 0;

        if (dailyPercent > 0) {
            // 1. บันทึกประวัติ (Transactions) ว่าได้รับโบนัส
            await client.query(`
                INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at)
                SELECT 
                    u.user_id, 'Bonus', 'โบนัสรายวันจากยอดรวมทีม', 
                    SUM(o.total_amount) * ($1 / 100.0), 'Completed', CURRENT_TIMESTAMP
                FROM Lottery_Orders o
                JOIN Users d ON o.user_id = d.user_id
                JOIN Users u ON d.referrer_username = u.username
                -- คิดจากยอดบิลของเมื่อวาน (เพราะรันตี 5 ของวันนี้)
                WHERE CAST(o.created_at AS DATE) = CAST(CURRENT_TIMESTAMP - INTERVAL '1 day' AS DATE)
                GROUP BY u.user_id
                HAVING SUM(o.total_amount) > 0;
            `, [dailyPercent]);

            // 2. เติมเงินโบนัสเข้า Wallets ของคนที่เป็นผู้แนะนำทั้งหมด
            await client.query(`
                UPDATE Wallets w
                SET balance = COALESCE(w.balance, 0) + t.bonus_amount
                FROM (
                    SELECT 
                        u.user_id, 
                        SUM(o.total_amount) * ($1 / 100.0) as bonus_amount
                    FROM Lottery_Orders o
                    JOIN Users d ON o.user_id = d.user_id
                    JOIN Users u ON d.referrer_username = u.username
                    WHERE CAST(o.created_at AS DATE) = CAST(CURRENT_TIMESTAMP - INTERVAL '1 day' AS DATE)
                    GROUP BY u.user_id
                    HAVING SUM(o.total_amount) > 0
                ) t WHERE w.user_id = t.user_id;
            `, [dailyPercent]);
        }

        await client.query('COMMIT');
        console.log('✅ [5:00 AM] แจกโบนัสรายวันสำเร็จเรียบร้อย!');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ เกิดข้อผิดพลาดในการแจกโบนัสรายวัน (Cron 5AM):', err);
    } finally {
        client.release();
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API: รายงานยอดขายหวยรายวัน (Admin) - แบบจัดกลุ่มบิล + รูปสัตว์
// ==========================================
app.get('/api/admin/daily-sales', async (req, res) => {
  try {
    const targetDate = req.query.date || new Date().toISOString().split('T')[0];

    // 1. ดึงสรุปยอดขาย 
    const summaryRes = await pgPool.query(`
        SELECT 
          COALESCE(SUM(CASE WHEN CAST(created_at AS DATE) = CAST($1 AS DATE) THEN total_amount ELSE 0 END), 0) AS daily_total,
          COALESCE(SUM(CASE WHEN EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CAST($1 AS DATE)) AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CAST($1 AS DATE)) THEN total_amount ELSE 0 END), 0) AS monthly_total
        FROM Lottery_Orders;
      `, [targetDate]
    );

    // 2. ดึงรายการซื้อทั้งหมดของวันนี้ พร้อมชื่อและรูปสัตว์ (ปรับ TOP 1 เป็น LIMIT 1)
    const salesRes = await pgPool.query(`
        SELECT 
          o.order_id,
          u.username,
          o.total_amount,
          o.currency_code,
          o.status as order_status,
          to_char(o.created_at, 'YYYY-MM-DD HH24:MI') as buy_time,
          i.item_id,
          i.lottery_type,
          i.selected_number,
          i.price,
          i.status as item_status,
          COALESCE(i.prize_amount, 0) as prize_amount,
          
          -- ดึงชื่อนามสัตว์
          COALESCE((
            SELECT animal_name_th 
            FROM Master_Animal_Numbers 
            WHERE CAST(lottery_type AS VARCHAR) = CAST(i.lottery_type AS VARCHAR) 
              AND (num1 = i.selected_number OR num2 = i.selected_number OR num3 = i.selected_number)
            LIMIT 1
          ), '') as animal_name,

          -- ดึงรูปภาพสัตว์
          COALESCE((
            SELECT image_url 
            FROM Master_Animal_Numbers 
            WHERE CAST(lottery_type AS VARCHAR) = CAST(i.lottery_type AS VARCHAR) 
              AND (num1 = i.selected_number OR num2 = i.selected_number OR num3 = i.selected_number)
            LIMIT 1
          ), '') as animal_image

        FROM Lottery_Orders o
        JOIN Users u ON o.user_id = u.user_id
        JOIN Lottery_Order_Items i ON o.order_id = i.order_id
        WHERE CAST(o.created_at AS DATE) = CAST($1 AS DATE)
        ORDER BY o.created_at DESC;
      `, [targetDate]
    );

    // 3. จัดกลุ่มข้อมูลด้วย JavaScript (รวม Item เข้าไปอยู่ในบิลเดียวกัน)
    const groupedOrders = {};
    const winnersList = [];
    let dailyPayout = 0;

    salesRes.rows.forEach(row => {
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
            dailyPayout += Number(row.prize_amount); // 🌟 กันเหนียวด้วย Number() เพื่อป้องกัน String ต่อกัน
        }
    });

    res.json({
      success: true,
      summary: {
        dailyTotal: summaryRes.rows[0].daily_total,
        monthlyTotal: summaryRes.rows[0].monthly_total,
        dailyPayout: dailyPayout
      },
      salesDetails: Object.values(groupedOrders), 
      winners: winnersList
    });

  } catch (error) {
    console.error('Error fetching daily sales:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงรายงาน' });
  }
});
// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// ⚙️ API: ดึงข้อมูลการตั้งค่าระบบ (GET)
// ==========================================
app.get('/api/admin/settings', async (req, res) => {
    try {
        const result = await pgPool.query(`
            SELECT 
                to_char(close_time, 'HH24:MI') as close_time,
                to_char(open_time, 'HH24:MI') as open_time,
                to_char(draw_time, 'HH24:MI') as draw_time,
                is_sales_open,
                is_auto_draw,
                auto_draw_percent
            FROM System_Settings 
            WHERE id = 1
        `);

        if (result.rows.length > 0) {
            res.json({ success: true, data: result.rows[0] });
        } else {
            res.json({ success: false, message: "ไม่พบการตั้งค่าในระบบ" });
        }
    } catch (err) {
        console.error("Error fetching settings:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API: บันทึกการตั้งค่าระบบและเวลา (POST)
// ==========================================
app.post('/api/admin/settings', async (req, res) => {
    const { close_time, open_time, draw_time, is_sales_open, is_auto_draw, auto_draw_percent } = req.body;
    
    // พิมพ์ค่าที่รับมาออกหน้าจอดำๆ เพื่อเช็คข้อมูล
    console.log("📥 ข้อมูลที่หน้าเว็บส่งมาบันทึก:", req.body); 

    try {
        await pgPool.query(`
                UPDATE System_Settings 
                SET 
                    close_time = CAST($1 AS TIME), 
                    open_time = CAST($2 AS TIME), 
                    draw_time = CAST($3 AS TIME), 
                    is_sales_open = $4,
                    is_auto_draw = $5,
                    auto_draw_percent = $6,
                    last_updated = CURRENT_TIMESTAMP
                WHERE id = 1
            `, [
                close_time, 
                open_time, 
                draw_time, 
                is_sales_open ? '1' : '0', 
                is_auto_draw ? '1' : '0', 
                parseInt(auto_draw_percent) || 50
            ]
        );
            
        console.log("✅ บันทึกเวลา ระบบออโต้ และ % สกอร์ ลงฐานข้อมูลสำเร็จ!");
        res.json({ success: true, message: 'บันทึกสำเร็จ' });
    } catch (err) { 
        console.error("❌ Error ตอนบันทึก:", err.message);
        res.status(500).json({ success: false, message: 'บันทึกไม่สำเร็จ' }); 
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API 2: บันทึกผลออกรางวัล และ ค้นหาคนถูกรางวัล
// ==========================================
app.post('/api/admin/draw-results', async (req, res) => {
    const { prize_8, prize_6, prize_4, prize_3, prize_2 } = req.body;
    const today = new Date().toISOString().split('T')[0];
    
    const client = await pgPool.connect(); // 🌟 ใช้ Transaction ป้องกันการอัปเดตบิลผิดพลาด

    try {
        await client.query('BEGIN');

        // 1. ตรวจสอบว่าวันนี้มีผลรางวัลหรือยัง?
        const checkExist = await client.query("SELECT 1 FROM Draw_Results WHERE draw_date = CAST($1 AS DATE)", [today]);
        
        if (checkExist.rows.length > 0) {
            await client.query(`
                UPDATE Draw_Results 
                SET prize_8=$1, prize_6=$2, prize_4=$3, prize_3=$4, prize_2=$5 
                WHERE draw_date=CAST($6 AS DATE)
            `, [prize_8, prize_6, prize_4, prize_3, prize_2, today]);
        } else {
            await client.query(`
                INSERT INTO Draw_Results (draw_date, prize_8, prize_6, prize_4, prize_3, prize_2) 
                VALUES (CAST($1 AS DATE), $2, $3, $4, $5, $6)
            `, [today, prize_8, prize_6, prize_4, prize_3, prize_2]);
        }

        // 2. อัปเดตสถานะบิลที่ "รอผลตรวจ" ให้เป็น "ถูกรางวัล" หรือ "ไม่ถูก" (🌟 ปรับใช้ Parameter เพื่อป้องกัน SQL Injection)
        await client.query(`
            UPDATE Lottery_Order_Items i SET 
                status = CASE 
                    WHEN (i.lottery_type = '2' AND i.selected_number = $1) OR
                         (i.lottery_type = '3' AND i.selected_number = $2) OR
                         (i.lottery_type = '4' AND i.selected_number = $3) OR
                         (i.lottery_type = '6' AND i.selected_number = $4) OR
                         (i.lottery_type = '8' AND i.selected_number = $5) THEN 'ถูกรางวัล'
                    ELSE 'ไม่ถูกรางวัล'
                END,
                prize_amount = CASE
                    WHEN i.lottery_type = '2' AND i.selected_number = $1 THEN i.price * 90
                    WHEN i.lottery_type = '3' AND i.selected_number = $2 THEN i.price * 900
                    WHEN i.lottery_type = '4' AND i.selected_number = $3 THEN i.price * 7000
                    WHEN i.lottery_type = '6' AND i.selected_number = $4 THEN i.price * 400000
                    WHEN i.lottery_type = '8' AND i.selected_number = $5 THEN i.price * 1000000
                    ELSE 0
                END
            FROM Lottery_Orders o
            WHERE i.order_id = o.order_id AND CAST(o.created_at AS DATE) = CAST($6 AS DATE) AND i.status = 'รอผลตรวจ';
        `, [prize_2, prize_3, prize_4, prize_6, prize_8, today]);

        // 3. ดึงรายชื่อคนถูกรางวัลส่งกลับไปหน้าเว็บเพื่อทำ PDF
        const winnersRes = await client.query(`
            SELECT u.username, i.lottery_type, i.selected_number, i.price, i.prize_amount, o.currency_code
            FROM Lottery_Order_Items i
            JOIN Lottery_Orders o ON i.order_id = o.order_id
            JOIN Users u ON o.user_id = u.user_id
            WHERE CAST(o.created_at AS DATE) = CAST($1 AS DATE) AND i.status = 'ถูกรางวัล';
        `, [today]);

        await client.query('COMMIT');
        res.json({ success: true, winners: winnersRes.rows });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error drawing results:', err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการตรวจรางวัล' });
    } finally {
        client.release();
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว (ลบตัวซ้ำออกให้แล้วครับ)
// 🌟 API 3: ส่งสถานะและเวลา ให้หน้าบ้านลูกค้า (ฝั่ง Client)
// ==========================================
app.get('/api/lottery/status', async (req, res) => {
    try {
        const result = await pgPool.query(`
            SELECT 
                to_char(close_time, 'HH24:MI') as close_time,
                to_char(open_time, 'HH24:MI') as open_time,
                to_char(draw_time, 'HH24:MI') as draw_time,
                is_sales_open 
            FROM System_Settings 
            WHERE id = 1
        `);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error('Error fetching lottery status:', err);
        res.status(500).json({ success: false });
    }
});
// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API: ดึงประวัติผลการออกรางวัลและรายชื่อคนถูกรางวัล ย้อนหลังตามวันที่ (เพิ่มยอดขาย)
// ==========================================
app.get('/api/admin/draw-history', async (req, res) => {
    const { date } = req.query; // คาดหวัง Format: YYYY-MM-DD (ค.ศ.)
    try {
        // 1. ดึงผลรางวัลของวันนั้น
        const resultRes = await pgPool.query("SELECT * FROM Draw_Results WHERE draw_date = CAST($1 AS DATE)", [date]);
            
        // 2. ดึงคนถูกรางวัลของวันนั้น
        const winnersRes = await pgPool.query(`
                SELECT i.item_id as order_item_id, u.username, i.lottery_type, i.selected_number, i.price, i.prize_amount, o.currency_code
                FROM Lottery_Order_Items i
                JOIN Lottery_Orders o ON i.order_id = o.order_id
                JOIN Users u ON o.user_id = u.user_id
                WHERE o.draw_date = CAST($1 AS DATE) AND i.status = 'ถูกรางวัล'
            `, [date]);

        // 3. 🌟 (เพิ่มใหม่) ดึงยอดขายรวมทั้งหมดของงวดนั้น แยกตามสกุลเงิน THB และ LAK
        const salesRes = await pgPool.query(`
                SELECT o.currency_code, SUM(i.price) as total_sales
                FROM Lottery_Order_Items i
                JOIN Lottery_Orders o ON i.order_id = o.order_id
                WHERE o.draw_date = CAST($1 AS DATE)
                GROUP BY o.currency_code
            `, [date]);

        let total_sales_thb = 0;
        let total_sales_lak = 0;

        // แยกตะกร้ายอดขายเงินบาท กับ เงินกีบ
        salesRes.rows.forEach(row => {
            if (row.currency_code === 'THB') {
                total_sales_thb += Number(row.total_sales);
            } else if (row.currency_code === 'LAK' || row.currency_code === '₭') {
                total_sales_lak += Number(row.total_sales);
            }
        });

        // 4. ส่งแพ็คเกจข้อมูลกลับไปให้หน้าเว็บ
        res.json({ 
            success: true, 
            results: resultRes.rows.length > 0 ? resultRes.rows[0] : null,
            winners: winnersRes.rows,
            total_sales_thb: total_sales_thb, // 🌟 ยอดขาย THB
            total_sales_lak: total_sales_lak  // 🌟 ยอดขาย LAK
        });
    } catch (err) {
        console.error("Error fetching draw history:", err);
        res.status(500).json({ success: false });
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API: ดึงประวัติผลการออกรางวัลแบบ "ช่วงวันที่" (รายเดือน)
// ==========================================
app.get('/api/admin/draw-history-range', async (req, res) => {
    const { startDate, endDate } = req.query;
    try {
        const result = await pgPool.query(`
                SELECT * FROM Draw_Results
                WHERE draw_date >= CAST($1 AS DATE) 
                  AND draw_date <= CAST($2 AS DATE)
                ORDER BY draw_date DESC
            `, [startDate, endDate]);
            
        res.json({ success: true, history: result.rows });
    } catch (err) {
        console.error("Error fetching history range:", err);
        res.status(500).json({ success: false });
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API 1: ดึงเรทการจ่ายรางวัล (Lottery_Prize_Rates)
// ==========================================
app.get('/api/admin/prize-rates', async (req, res) => {
    try {
        const result = await pgPool.query("SELECT * FROM Lottery_Prize_Rates ORDER BY CAST(lottery_type AS INTEGER) ASC");
        res.json({ success: true, rates: result.rows });
    } catch (err) { 
        res.status(500).json({ success: false }); 
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API 2: อัปเดตเรทการจ่ายรางวัล
// ==========================================
app.post('/api/admin/prize-rates', async (req, res) => {
    const { rates } = req.body;
    const client = await pgPool.connect(); // ใช้ Transaction เพื่อประสิทธิภาพเวลา Update หลายแถว
    try {
        await client.query('BEGIN');
        for (let r of rates) {
            await client.query("UPDATE Lottery_Prize_Rates SET multiplier = $1 WHERE id = $2", [r.multiplier, r.id]);
        }
        await client.query('COMMIT');
        res.json({ success: true, message: "อัปเดตอัตราจ่ายสำเร็จ" });
    } catch (err) { 
        await client.query('ROLLBACK');
        console.error('Error updating prize rates:', err);
        res.status(500).json({ success: false }); 
    } finally {
        client.release();
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API: ดึงและอัปเดตอัตราแลกเปลี่ยน (ExchangeRates)
// ==========================================
app.get('/api/admin/exchange-rates', async (req, res) => {
    try {
        const result = await pgPool.query("SELECT * FROM ExchangeRates");
        res.json({ success: true, rates: result.rows });
    } catch (err) { 
        res.status(500).json({ success: false }); 
    }
});

app.post('/api/admin/exchange-rates', async (req, res) => {
    const { pair, rate } = req.body;
    try {
        await pgPool.query("UPDATE ExchangeRates SET rate = $1, last_updated = CURRENT_TIMESTAMP WHERE currency_pair = $2", [rate, pair]);
        res.json({ success: true, message: "อัปเดตเรทเงินสำเร็จ" });
    } catch (err) { 
        console.error('Error updating exchange rate:', err);
        res.status(500).json({ success: false }); 
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API 3: เช็คยอดวิเคราะห์ความเสี่ยง (Analyze Draw)
// ==========================================
app.post('/api/admin/analyze-draw', async (req, res) => {
    const { number } = req.body; 
    try {
        // ดึงเรทแลกเปลี่ยนสดๆ ทุกครั้งที่กดปุ่ม
        const rateRes = await pgPool.query("SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'");
        const exchangeRate = rateRes.rows.length > 0 ? parseFloat(rateRes.rows[0].rate) : 500.0;

        const num6 = number;
        const num4 = number.slice(-4);
        const num3 = number.slice(-3);
        const num2 = number.slice(-2);

        // 🌟 เปลี่ยน ISNULL เป็น COALESCE และอัปเกรดความปลอดภัยด้วยการโยน $1
        const salesRes = await pgPool.query(`
            SELECT COALESCE(SUM(CASE WHEN currency_code = 'LAK' THEN total_amount / $1 ELSE total_amount END), 0) as "totalSalesTHB" 
            FROM Lottery_Orders 
            WHERE status = 'รอผลตรวจ'
        `, [exchangeRate]);
            
        const totalSales = salesRes.rows[0].totalSalesTHB;

        // 🌟 แก้ไขการ CAST ให้เป็น VARCHAR เพื่อไม่ให้พังเวลาเจอข้อมูลเช่น '2 ล่าง'
        const analysisRes = await pgPool.query(`
                SELECT 
                    CAST(i.lottery_type AS VARCHAR) as lottery_type,
                    COUNT(i.item_id) as winner_count,
                    SUM(CASE WHEN o.currency_code = 'LAK' THEN (i.price * r.multiplier) / $1 ELSE (i.price * r.multiplier) END) as total_payout
                FROM Lottery_Order_Items i
                JOIN Lottery_Orders o ON i.order_id = o.order_id
                LEFT JOIN Lottery_Prize_Rates r ON CAST(i.lottery_type AS VARCHAR) = CAST(r.lottery_type AS VARCHAR)
                WHERE o.status = 'รอผลตรวจ' AND i.status = 'รอผลตรวจ'
                AND (
                    (i.lottery_type = '2' AND i.selected_number = $2) OR
                    (i.lottery_type = '3' AND i.selected_number = $3) OR
                    (i.lottery_type = '4' AND i.selected_number = $4) OR
                    (i.lottery_type = '6' AND i.selected_number = $5)
                )
                GROUP BY CAST(i.lottery_type AS VARCHAR)
            `, [exchangeRate, num2, num3, num4, num6]
        );
        
        res.json({ success: true, totalSales, analysis: analysisRes.rows });
    } catch (err) { 
        console.error('Error analyzing draw:', err);
        res.status(500).json({ success: false }); 
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API หวยไทย เริ่ม
// ==========================================
// ==========================================
// 1. 🇹🇭 API: ดึงข้อมูลรอบหวยไทยทั้งหมด (สำหรับฝั่ง Admin) -> แก้บั๊ก Timezone
// ==========================================
app.get('/api/admin/thai-lottery/rounds', async (req, res) => {
    try {
        const result = await pgPool.query(`
            SELECT round_id, 
                   COALESCE(round_name, CAST(round_number AS VARCHAR(100))) as round_number, 
                   to_char(open_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS open_time, 
                   to_char(close_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS close_time, 
                   to_char(draw_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS draw_time, 
                   status, result_8_super as result_6, result_2_bottom 
            FROM Yeeki_Rounds 
            WHERE category = 'THAI' 
            ORDER BY draw_time DESC
        `);
        res.json({ success: true, rounds: result.rows });
    } catch (err) {
        console.error("Error fetching Thai rounds:", err);
        res.status(500).json({ success: false });
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 2. 🇹🇭 API: ดึงข้อมูลหวยไทยงวดปัจจุบัน (สำหรับหน้าเว็บลูกค้า) -> แก้บั๊ก Timezone
// ==========================================
app.get('/api/thai-lottery/current-round', async (req, res) => {
    try {
        const roundReq = await pgPool.query(`
            SELECT 
                round_id, 
                COALESCE(round_name, CAST(round_number AS VARCHAR(100))) as round_number, 
                to_char(open_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS open_time, 
                to_char(close_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS close_time, 
                to_char(draw_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS draw_time, 
                status 
            FROM Yeeki_Rounds 
            WHERE category = 'THAI' AND status != 'Completed' 
            ORDER BY close_time ASC
            LIMIT 1
        `);

        if (roundReq.rows.length > 0) {
            res.json({ success: true, round: roundReq.rows[0] });
        } else {
            res.json({ success: true, round: null, message: 'ยังไม่มีการเปิดรับแทงหวยไทยในขณะนี้' });
        }
    } catch (err) {
        console.error("Error fetching current Thai round:", err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 2. 🇹🇭 สร้างงวดหวยไทยใหม่ (แก้ปัญหา Error Type INT, ภาษาไทย และ draw_date NULL)
// ==========================================
app.post('/api/admin/thai-lottery/create-round', async (req, res) => {
    const { round_number, open_time, close_time, draw_time } = req.body;
    if (!round_number || !open_time || !close_time || !draw_time) {
        return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูล วันเวลาเปิด-ปิด ให้ครบถ้วน' });
    }

    try {
        // 🌟 1. ดึงชื่อภาษาไทยมาเก็บไว้ในตัวแปรแยก
        const roundNameText = round_number; 
        
        // 🌟 2. สร้างเลขจำลองให้คอลัมน์ round_number เดิม (เช่น วันที่ 16/08/2026 -> 20260816)
        const d = new Date(draw_time);
        const fakeIntRound = parseInt(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`);

        // เช็คว่าซ้ำไหม
        const checkReq = await pgPool.query(`SELECT 1 FROM Yeeki_Rounds WHERE round_name = $1 AND category = 'THAI'`, [roundNameText]);
            
        if (checkReq.rows.length > 0) return res.status(400).json({ success: false, message: 'งวดหวยไทยนี้ถูกสร้างไว้แล้ว' });

        // 🌟 3. บันทึกลงฐานข้อมูล (สั่งให้ SQL คัดลอกวันที่จาก $4 ไปใส่ใน draw_date ด้วย CAST)
        await pgPool.query(`
            INSERT INTO Yeeki_Rounds (round_number, round_name, open_time, close_time, draw_time, draw_date, status, category)
            VALUES ($1, $2, $3, $4, $5, CAST($5 AS DATE), 'Pending', 'THAI')
        `, [fakeIntRound, roundNameText, open_time, close_time, draw_time]);

        res.json({ success: true, message: `✅ สร้างงวดหวยไทย (${roundNameText}) สำเร็จ!` });
    } catch (err) { 
        res.status(500).json({ success: false, message: err.message }); 
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 3. 🇹🇭 ประกาศผลหวยไทย + จ่ายเงินรางวัลและค่าคอมมิชชัน
// ==========================================
app.post('/api/admin/thai-lottery/execute-draw', async (req, res) => {
    const { round_id, number6, number2bot } = req.body;
    
    if (!round_id || !number6 || !number2bot || number6.length !== 6 || number2bot.length !== 2) {
        return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน กรุณากรอกเลขให้ถูกต้อง' });
    }

    const client = await pgPool.connect(); // 🌟 เปิด Transaction ใช้งานจริงจัง!
    
    try {
        // แตกตัวเลขตามกติกาหวยใต้ดินไทย
        const top_6 = number6;
        const top_4 = top_6.slice(-4);
        const top_3 = top_6.slice(-3);
        const top_2 = top_6.slice(-2);
        const bot_2 = number2bot;
        const top_3_sorted = top_3.split('').sort().join('');

        // ดึงเรทจ่ายหวยยี่กีมาใช้
        const ratesReq = await client.query(`SELECT lottery_type, multiplier FROM Yeeki_Prize_Rates`);
        const prizeRates = {};
        ratesReq.rows.forEach(r => prizeRates[r.lottery_type] = r.multiplier);

        let winCommissionPercent = 0;
        try {
            const commReq = await client.query(`SELECT win_percent FROM Commission_Settings LIMIT 1`);
            if (commReq.rows.length > 0) winCommissionPercent = commReq.rows[0].win_percent || 0;
        } catch (e) {}

        await client.query('BEGIN'); // เริ่มล็อค DB

        // 3.1 บันทึกเลขที่ออกลงตารางรอบหวย
        await client.query(`
            UPDATE Yeeki_Rounds 
            SET result_8_super = $1, result_4_top = $2, result_3_top = $3, result_2_bottom = $4, status = 'Completed' 
            WHERE round_id = $5
        `, [top_6, top_4, top_3, bot_2, round_id]);

        // 3.2 ดึงบิลหวยไทยที่รอตรวจทั้งหมดของรอบนี้
        const ordersReq = await client.query(`
            SELECT i.item_id, o.user_id, i.lottery_type, i.selected_number, i.price, o.currency_code
            FROM Yeeki_Order_Items i JOIN Yeeki_Orders o ON i.order_id = o.order_id
            WHERE o.round_id = $1 AND i.status = 'รอผลตรวจ'
        `, [round_id]);
        
        let totalWinners = 0;

        // 3.3 ตรวจบิล จ่ายเงิน จ่ายค่าคอมฯ ทีละใบ
        for (let item of ordersReq.rows) {
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

                // อัปเดตสถานะชนะ
                await client.query(`UPDATE Yeeki_Order_Items SET status = 'ชนะ', prize_amount = $1 WHERE item_id = $2`, [prizeAmount, item.item_id]);

                // 🌟 อัปเดตเงินเข้ากระเป๋าหลัก (balance)
                await client.query(`UPDATE Wallets SET balance = balance + $1 WHERE user_id = $2`, [prizeAmount, item.user_id]);

                // บันทึก Log การรับเงิน
                await client.query(`
                    INSERT INTO Transactions (user_id, amount, currency_code, transaction_type, status, title, created_at) 
                    VALUES ($1, $2, $3, 'deposit', 'Completed', $4, CURRENT_TIMESTAMP)
                `, [item.user_id, prizeAmount, currency, `ถูกรางวัลหวยไทย ${item.lottery_type}`]);

                // 💵 จ่ายค่าคอมฯ ผู้แนะนำ
                if (winCommissionPercent > 0) {
                    const refReq = await client.query(`SELECT referrer_id FROM User_Referrals WHERE user_id = $1`, [item.user_id]);
                    if (refReq.rows.length > 0) {
                        let refId = refReq.rows[0].referrer_id;
                        let commAmt = prizeAmount * (winCommissionPercent / 100);
                        
                        // 🌟 อัปเดตเงินค่าคอมเข้ากระเป๋าหลัก
                        await client.query(`UPDATE Wallets SET balance = balance + $1 WHERE user_id = $2`, [commAmt, refId]);

                        // บันทึก Log การรับค่าคอม
                        await client.query(`
                            INSERT INTO Transactions (user_id, amount, currency_code, transaction_type, status, title, created_at) 
                            VALUES ($1, $2, $3, 'commission', 'Completed', $4, CURRENT_TIMESTAMP)
                        `, [refId, commAmt, currency, `ค่าคอมหวยไทยลูกทีมถูกรางวัล ${winCommissionPercent}%`]);
                    }
                }
            } else {
                await client.query(`UPDATE Yeeki_Order_Items SET status = 'ไม่ถูกรางวัล', prize_amount = 0 WHERE item_id = $1`, [item.item_id]);
            }
        }

        // 3.4 ปิดบิลใหญ่
        await client.query(`UPDATE Yeeki_Orders SET status = 'ตรวจผลแล้ว' WHERE round_id = $1`, [round_id]);

        await client.query('COMMIT');
        res.json({ success: true, message: `✅ ประกาศผลหวยไทยสำเร็จ! จ่ายเงินผู้ชนะ ${totalWinners} รายการ` });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Execute Thai Draw Error:", err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
    } finally {
        client.release();
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 7. 🇹🇭 API: ดึงรายการบิลลูกค้าหวยไทยรายงวด (สำหรับหน้ารายงาน)
// ==========================================
app.get('/api/admin/thai-lottery/round-tickets/:roundId', async (req, res) => {
    try {
        const result = await pgPool.query(`
            SELECT 
                u.username,
                o.currency_code,
                i.lottery_type,
                i.selected_number,
                i.price,
                i.status,
                i.prize_amount,
                o.created_at
            FROM Yeeki_Order_Items i
            JOIN Yeeki_Orders o ON i.order_id = o.order_id
            LEFT JOIN Users u ON o.user_id = u.user_id
            WHERE o.round_id = $1
            ORDER BY o.created_at DESC
        `, [req.params.roundId]);
        
        res.json({ success: true, tickets: result.rows });
    } catch (err) {
        console.error("Fetch Tickets Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 6. 🇹🇭 API: ดึงรายงานยอดขายหวยไทย (สำหรับหน้า Admin Report)
// ==========================================
app.get('/api/admin/thai-lottery/sales-report', async (req, res) => {
    try {
        // 🌟 ดึงข้อมูลสรุปยอดขายแยกตามงวด แยกสกุลเงิน (THB/LAK) และสถานะการตรวจรางวัล
        const reportReq = await pgPool.query(`
            SELECT 
                r.round_id, 
                r.round_number, 
                to_char(r.open_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS open_time, 
                to_char(r.close_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS close_time, 
                to_char(r.draw_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS draw_time, 
                r.status, 
                r.result_8_super as result_6, 
                r.result_2_bottom,
                
                -- สรุปยอดขาย (THB และ LAK)
                COALESCE(SUM(CASE WHEN o.currency_code IN ('THB', '฿') THEN i.price ELSE 0 END), 0) as total_sales_thb,
                COALESCE(SUM(CASE WHEN o.currency_code IN ('LAK', '₭') THEN i.price ELSE 0 END), 0) as total_sales_lak,
                
                -- สรุปยอดจ่ายรางวัล (THB และ LAK)
                COALESCE(SUM(CASE WHEN o.currency_code IN ('THB', '฿') AND i.status = 'ชนะ' THEN i.prize_amount ELSE 0 END), 0) as total_payout_thb,
                COALESCE(SUM(CASE WHEN o.currency_code IN ('LAK', '₭') AND i.status = 'ชนะ' THEN i.prize_amount ELSE 0 END), 0) as total_payout_lak,
                
                -- สรุปสถานะบิล
                COUNT(i.item_id) as total_tickets,
                COUNT(CASE WHEN i.status = 'ชนะ' THEN 1 END) as winners_count,
                COUNT(CASE WHEN i.status = 'รอผลตรวจ' THEN 1 END) as pending_count,
                COUNT(CASE WHEN i.status = 'ไม่ถูกรางวัล' THEN 1 END) as lost_count
                
            FROM Yeeki_Rounds r
            LEFT JOIN Yeeki_Orders o ON r.round_id = o.round_id
            LEFT JOIN Yeeki_Order_Items i ON o.order_id = i.order_id
            WHERE r.category = 'THAI'
            GROUP BY r.round_id, r.round_number, r.open_time, r.close_time, r.draw_time, r.status, r.result_8_super, r.result_2_bottom
            ORDER BY r.draw_time DESC
        `);

        res.json({ success: true, reports: reportReq.rows });
    } catch (err) {
        console.error("Sales Report Error:", err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงรายงาน' });
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 5. 🇹🇭 API: แก้ไขข้อมูลงวดหวยไทย (ป้องกันงวดขยะ)
// ==========================================
app.post('/api/admin/thai-lottery/edit-round', async (req, res) => {
    const { round_id, round_number, open_time, close_time, draw_time } = req.body;
    
    if (!round_id || !round_number || !open_time || !close_time || !draw_time) {
        return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
    }

    try {
        // เช็คสถานะก่อนว่ามีสิทธิ์แก้ไหม (ถ้าออกผลแล้วห้ามแก้)
        const check = await pgPool.query(`SELECT status FROM Yeeki_Rounds WHERE round_id = $1`, [round_id]);
        if (check.rows.length === 0) return res.status(404).json({ success: false, message: 'ไม่พบงวดนี้ในระบบ' });
        if (check.rows[0].status === 'Completed') return res.status(400).json({ success: false, message: 'งวดนี้ประกาศผลไปแล้ว ไม่สามารถแก้ไขได้' });

        // แปลงข้อมูลให้ตรงฟอร์แมต
        const roundNameText = round_number; 
        const d = new Date(draw_time);
        const fakeIntRound = parseInt(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`);

        // อัปเดตข้อมูล
        await pgPool.query(`
                UPDATE Yeeki_Rounds 
                SET round_number = $1, 
                    round_name = $2, 
                    open_time = $3, 
                    close_time = $4, 
                    draw_time = $5, 
                    draw_date = CAST($5 AS DATE)
                WHERE round_id = $6
            `, [fakeIntRound, roundNameText, open_time, close_time, draw_time, round_id]
        );

        res.json({ success: true, message: '✅ อัปเดตข้อมูลสำเร็จ!' });
    } catch (err) {
        console.error("Edit Round Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 4. 🇹🇭 API: ซื้อหวยรัฐบาลไทย (แยกตาราง Yeeki_Orders และแยกบิล 100%)
// ==========================================
app.post('/api/thai-lottery/buy', async (req, res) => {
    const { user_id, round_id, cart, total_price, currency, note } = req.body;
    
    // เช็คว่ามีงวดที่กำลังเปิดรับอยู่หรือไม่
    const statusRes = await pgPool.query("SELECT status, close_time FROM Yeeki_Rounds WHERE round_id = $1 AND category = 'THAI'", [round_id]);
    if (statusRes.rows.length === 0 || statusRes.rows[0].status === 'Completed') {
        return res.status(400).json({ success: false, message: 'งวดนี้ปิดรับแทงแล้ว หรือไม่มีในระบบ' });
    }

    const client = await pgPool.connect(); // 🌟 เริ่ม Transaction แบบเต็มรูปแบบ

    try {
        await client.query('BEGIN');

        // 1. ดึงเรทเงิน ถ้าเป็น LAK
        let exchangeRate = 1;
        if (currency === 'LAK' || currency === '₭') {
            const rateRes = await client.query("SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'");
            if (rateRes.rows.length > 0) exchangeRate = parseFloat(rateRes.rows[0].rate);
        }

        const baseTHBAmount = total_price / exchangeRate;
        const deductAmount = baseTHBAmount * exchangeRate; 

        // 2. ตัดเงิน
        const userRes = await client.query('SELECT balance FROM Wallets WHERE user_id = $1', [user_id]); 
        if (userRes.rows.length === 0) throw new Error('ไม่พบกระเป๋าเงิน');
        if (parseFloat(userRes.rows[0].balance) < deductAmount) throw new Error('ยอดเงินในกระเป๋าไม่เพียงพอ');

        await client.query(`
            UPDATE Users SET wallet_balance = COALESCE(wallet_balance, 0) - $1 WHERE user_id = $2;
            UPDATE Wallets SET balance = balance - $1 WHERE user_id = $2;
        `, [deductAmount, user_id]);

        // 3. บันทึกประวัติ Transaction ฝั่งหวยไทย
        await client.query(`
            INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at)
            VALUES ($1, 'Buy Lottery', 'ซื้อหวยรัฐบาลไทย', $2, 'Completed', CURRENT_TIMESTAMP)
        `, [user_id, -deductAmount]);

        // 4. บันทึกบิลลงตาราง Yeeki_Orders
        const orderRes = await client.query(`
            INSERT INTO Yeeki_Orders (user_id, round_id, total_amount, currency_code, status, order_note, category, created_at)
            VALUES ($1, $2, $3, $4, 'รอผลตรวจ', $5, 'THAI', CURRENT_TIMESTAMP)
            RETURNING order_id
        `, [user_id, round_id, deductAmount, currency, note || null]);
        
        const orderId = orderRes.rows[0].order_id;

       // บันทึกตัวเลข
        for (const item of cart) {
            await client.query(`
                INSERT INTO Yeeki_Order_Items (order_id, lottery_type, selected_number, price, status) 
                VALUES ($1, $2, $3, $4, 'รอผลตรวจ')
            `, [orderId, item.type, item.number, item.price]);
        }

        // 5. ระบบจ่ายค่าแนะนำหวยไทย (Cross-Currency เหมือนเวียดนาม)
        const referrerRes = await client.query(`
            SELECT u_referrer.user_id, u_buyer.username as buyer_username,
                   COALESCE(u_buyer.currency_code, 'THB') as buyer_currency, COALESCE(u_referrer.currency_code, 'THB') as referrer_currency
            FROM Users u_buyer JOIN Users u_referrer ON u_buyer.referrer_username = u_referrer.username WHERE u_buyer.user_id = $1
        `, [user_id]);

        if (referrerRes.rows.length > 0) {
            const ref = referrerRes.rows[0];
            const settingRes = await client.query("SELECT purchase_percent FROM Commission_Settings LIMIT 1");
            const purchasePercent = settingRes.rows.length > 0 ? parseFloat(settingRes.rows[0].purchase_percent) : 2.00; 
            
            let finalCommission = deductAmount * (purchasePercent / 100); 

            if (ref.buyer_currency !== ref.referrer_currency) {
                const pair = `${ref.buyer_currency}_${ref.referrer_currency}`; 
                const rateRes = await client.query(`SELECT rate FROM ExchangeRates WHERE currency_pair = $1`, [pair]);
                if (rateRes.rows.length > 0) {
                    finalCommission = finalCommission * parseFloat(rateRes.rows[0].rate);
                } else {
                    const revRes = await client.query(`SELECT rate FROM ExchangeRates WHERE currency_pair = $1`, [`${ref.referrer_currency}_${ref.buyer_currency}`]);
                    if (revRes.rows.length > 0) finalCommission = finalCommission / parseFloat(revRes.rows[0].rate);
                }
            }

            const tTitle = `รายได้ ${purchasePercent}% หวยไทย จากทีมงาน (${ref.buyer_username})`;
            
            await client.query(`
                UPDATE Wallets SET balance = balance + $1 WHERE user_id = $2;
                UPDATE Users SET total_purchase_comm = COALESCE(total_purchase_comm, 0) + $1 WHERE user_id = $2;
                INSERT INTO Transactions (user_id, transaction_type, title, amount, status, created_at)
                VALUES ($2, 'Affiliate Purchase', $3, $1, 'Completed', CURRENT_TIMESTAMP);
            `, [finalCommission, ref.user_id, tTitle]);
        }

        await client.query('COMMIT');
        res.status(200).json({ success: true, message: 'ชำระเงินหวยไทยสำเร็จ', order_id: orderId });

    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ success: false, message: error.message || 'เกิดข้อผิดพลาดในการชำระเงิน' });
    } finally {
        client.release();
    }
});
// ==========================================
// 🌟 API หวยไทย จบ
// ==========================================

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🇻🇳 API: ระบบ AI ค้นหาเลขหวยเวียดนาม (Risk Management)
// ==========================================
app.post('/api/admin/suggest-draw', async (req, res) => {
    const { targetPercent } = req.body;
    try {
        // ดึงเรทแลกเปลี่ยน และอัตราจ่าย
        const exReq = await pgPool.query(`SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'`);
        const lakRate = exReq.rows.length > 0 ? parseFloat(exReq.rows[0].rate) : 620;

        const ratesReq = await pgPool.query(`SELECT lottery_type, multiplier FROM Lottery_Prize_Rates`);
        const prizeRates = {};
        ratesReq.rows.forEach(r => prizeRates[r.lottery_type] = parseFloat(r.multiplier));

        // ดึงโพยหวยเวียดนามที่ยังไม่ได้ตรวจ
        const ordersReq = await pgPool.query(`
            SELECT i.lottery_type, i.selected_number, i.price, o.currency_code
            FROM Lottery_Order_Items i
            JOIN Lottery_Orders o ON i.order_id = o.order_id
            WHERE o.status = 'รอผลตรวจ' AND i.status = 'รอผลตรวจ'
        `);
        const items = ordersReq.rows;

        let totalSalesTHB = 0;
        let boughtNumbers = []; 
        items.forEach(item => {
            let thbPrice = (item.currency_code === 'LAK' || item.currency_code === '₭') ? (item.price / lakRate) : parseFloat(item.price);
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
                let thbPrice = (item.currency_code === 'LAK' || item.currency_code === '₭') ? (item.price / lakRate) : parseFloat(item.price);
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
lastAutoDrawDate = '';

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🇻🇳 2. API: ยืนยันผล จ่ายรางวัล และโอนเงิน (หวยเวียดนาม)
// ==========================================
app.post('/api/admin/execute-draw', async (req, res) => {
    const { number6 } = req.body;
    const client = await pgPool.connect(); // 🌟 เปิดใช้งาน Transaction

    try {
        await client.query('BEGIN');

        const top_6 = number6;
        const top_4 = top_6.slice(-4);
        const top_3 = top_6.slice(-3);
        const top_2 = top_6.slice(-2);
        const num8 = Math.floor(10000000 + Math.random() * 90000000).toString(); 
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

        // 1. บันทึกผลลง Draw_Results
        const checkExist = await client.query("SELECT 1 FROM Draw_Results WHERE draw_date = CAST($1 AS DATE)", [today]);
        if (checkExist.rows.length === 0) {
            await client.query(`
                INSERT INTO Draw_Results (draw_date, prize_8, prize_6, prize_4, prize_3, prize_2) 
                VALUES (CAST($1 AS DATE), $2, $3, $4, $5, $6)
            `, [today, num8, top_6, top_4, top_3, top_2]);
        } else {
            await client.query(`
                UPDATE Draw_Results 
                SET prize_8 = $2, prize_6 = $3, prize_4 = $4, prize_3 = $5, prize_2 = $6 
                WHERE draw_date = CAST($1 AS DATE)
            `, [today, num8, top_6, top_4, top_3, top_2]);
        }

        const commReq = await client.query("SELECT win_percent FROM Commission_Settings LIMIT 1");
        const commPercent = commReq.rows.length > 0 ? parseFloat(commReq.rows[0].win_percent) : 0;

        // 2. ตรวจบิลและตั้งค่าเงินรางวัล (คูณเรท)
        await client.query(`
            UPDATE Lottery_Order_Items i SET 
                status = CASE 
                    WHEN (i.lottery_type = '2 ล่าง' AND i.selected_number = $1) OR
                         (i.lottery_type = '2' AND i.selected_number = $1) OR
                         (i.lottery_type = '3' AND i.selected_number = $2) OR
                         (i.lottery_type = '4' AND i.selected_number = $3) OR
                         (i.lottery_type = '6' AND i.selected_number = $4) OR
                         (i.lottery_type = '8' AND i.selected_number = $5) THEN 'ถูกรางวัล'
                    ELSE 'ไม่ถูกรางวัล'
                END,
                prize_amount = CASE
                    WHEN (i.lottery_type = '2 ล่าง' AND i.selected_number = $1) OR
                         (i.lottery_type = '2' AND i.selected_number = $1) OR
                         (i.lottery_type = '3' AND i.selected_number = $2) OR
                         (i.lottery_type = '4' AND i.selected_number = $3) OR
                         (i.lottery_type = '6' AND i.selected_number = $4) OR
                         (i.lottery_type = '8' AND i.selected_number = $5) 
                    THEN i.price * COALESCE((SELECT multiplier FROM Lottery_Prize_Rates WHERE CAST(lottery_type AS VARCHAR) = CAST(i.lottery_type AS VARCHAR) LIMIT 1), 0)
                    ELSE 0
                END
            FROM Lottery_Orders o
            WHERE i.order_id = o.order_id AND (o.draw_date = CAST($6 AS DATE) OR CAST(o.created_at AS DATE) = CAST($6 AS DATE)) AND i.status = 'รอผลตรวจ';
        `, [top_2, top_3, top_4, top_6, num8, today]);

        // 3. 💰 โอนเงินลูกค้า (รวมกระเป๋าตามโครงสร้างฐานข้อมูลใหม่ ให้โค้ดสั้นและไวขึ้น!)
        await client.query(`
            UPDATE Wallets w SET 
                balance = COALESCE(w.balance, 0) + COALESCE(t.TotalPrize, 0)
            FROM (
                SELECT o.user_id, SUM(i.prize_amount) as TotalPrize
                FROM Lottery_Order_Items i 
                JOIN Lottery_Orders o ON i.order_id = o.order_id 
                WHERE i.status = 'ถูกรางวัล' AND o.status = 'รอผลตรวจ' 
                GROUP BY o.user_id
            ) t
            WHERE w.user_id = t.user_id;
        `);

        // บันทึกประวัติ
        await client.query(`
            INSERT INTO Transactions (user_id, amount, currency_code, transaction_type, status, title, created_at)
            SELECT o.user_id, SUM(i.prize_amount), o.currency_code, 'deposit', 'Completed', 'ถูกรางวัลหวยเวียดนาม', CURRENT_TIMESTAMP
            FROM Lottery_Order_Items i 
            JOIN Lottery_Orders o ON i.order_id = o.order_id 
            WHERE i.status = 'ถูกรางวัล' AND o.status = 'รอผลตรวจ' 
            GROUP BY o.user_id, o.currency_code;
        `);

        // 4. 💸 จ่ายค่าคอมผู้แนะนำ
        if (commPercent > 0) {
            await client.query(`
                UPDATE Wallets w SET 
                    balance = COALESCE(w.balance, 0) + COALESCE(c.CommAmount, 0)
                FROM (
                    SELECT r.referrer_id, SUM(i.prize_amount) * ($1 / 100.0) as CommAmount
                    FROM Lottery_Order_Items i 
                    JOIN Lottery_Orders o ON i.order_id = o.order_id 
                    JOIN User_Referrals r ON o.user_id = r.user_id
                    WHERE i.status = 'ถูกรางวัล' AND o.status = 'รอผลตรวจ' 
                    GROUP BY r.referrer_id 
                    HAVING SUM(i.prize_amount) > 0
                ) c
                WHERE w.user_id = c.referrer_id;
            `, [commPercent]);

            // บันทึกประวัติค่าคอมให้ผู้แนะนำ
            await client.query(`
                INSERT INTO Transactions (user_id, amount, currency_code, transaction_type, status, title, created_at)
                SELECT r.referrer_id, SUM(i.prize_amount) * ($1 / 100.0), o.currency_code, 'commission', 'Completed', 'ค่าคอมฯ ลูกทีมถูกรางวัล (' || u.username || ')', CURRENT_TIMESTAMP
                FROM Lottery_Order_Items i 
                JOIN Lottery_Orders o ON i.order_id = o.order_id 
                JOIN User_Referrals r ON o.user_id = r.user_id 
                JOIN Users u ON o.user_id = u.user_id
                WHERE i.status = 'ถูกรางวัล' AND o.status = 'รอผลตรวจ' 
                GROUP BY r.referrer_id, o.currency_code, u.username 
                HAVING SUM(i.prize_amount) > 0;
            `, [commPercent]);
        }

        // 5. ปิดบิลแม่
        await client.query(`
            UPDATE Lottery_Orders 
            SET status = 'ตรวจผลแล้ว', draw_date = CAST($1 AS DATE) 
            WHERE (draw_date = CAST($1 AS DATE) OR CAST(created_at AS DATE) = CAST($1 AS DATE)) AND status = 'รอผลตรวจ';
        `, [today]);

        await client.query('COMMIT');
        res.json({ success: true, message: `✅ ออกรางวัลด้วยเลข ${top_6} สำเร็จ! \n💰 จ่ายเงินลูกค้า และผู้แนะนำเรียบร้อยแล้ว!` });

    } catch (err) { 
        await client.query('ROLLBACK');
        console.error("Execute Draw Error:", err);
        res.status(500).json({ success: false, message: `Database Error: ${err.message}` }); 
    } finally {
        client.release();
    }
});
// 🌟 นำตัวแปรนี้ไปวางไว้บนสุดของไฟล์ server.js (หรือเหนือบรรทัด setInterval)
// เพื่อให้หุ่นยนต์จำว่าวันนี้ออกผลไปแล้วหรือยัง
let lastAutoDrawDate = '';

// ==========================================
// 🤖 3. Worker: หุ่นยนต์ออกรางวัลอัตโนมัติ (แก้บั๊ก Database)
// ==========================================
setInterval(async () => {
    try {
        const options = { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false };
        const nowBKK = new Intl.DateTimeFormat('en-GB', options).format(new Date()); 
        
        // ดึงวันที่ปัจจุบัน (YYYY-MM-DD) โซนไทย
        const todayDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());

        const API_URL = 'https://api.salapi.company'; // ถ้าเทสในเครื่องเปลี่ยนเป็น http://localhost:PORT

        const settingsRes = await fetch(`${API_URL}/api/admin/settings`);
        if (!settingsRes.ok) return;
        
        const settingsData = await settingsRes.json();
        const settings = settingsData.data;

        // 🌟 ดักจับสถานะ is_auto_draw ให้รองรับทั้งแบบ String และ Boolean จาก Postgres
        if (!settings || !settings.is_auto_draw || settings.is_auto_draw === '0' || settings.is_auto_draw === false) return; 

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
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API สุ่มเลขแนะนำ (AI V21: Auto-Detect Round ID แก้บั๊กหุ่นยนต์ลืมส่งรอบ)
// ==========================================
app.post('/api/admin/yeeki/suggest-draw', async (req, res) => {
    // 🌟 รองรับชื่อตัวแปรทุกรูปแบบ ทั้งจากหน้าเว็บ และจากหุ่นยนต์หลังบ้าน
    let target_percent = req.body.target_percent !== undefined ? req.body.target_percent : req.body.targetPercent;
    let round_id = req.body.round_id !== undefined ? req.body.round_id : req.body.roundId;

    try {
        // 🌟 จุดแก้ปัญหา: ถ้าไม่มี round_id ส่งมา ให้ไปค้นหารอบล่าสุดที่รอออกผลเอง
        if (!round_id) {
            const activeRoundReq = await pgPool.query(`
                SELECT round_id, round_number FROM Yeeki_Rounds 
                WHERE status = 'Closed' OR status = 'Pending' 
                ORDER BY round_number ASC
                LIMIT 1
            `);
            if (activeRoundReq.rows.length > 0) {
                round_id = activeRoundReq.rows[0].round_id;
                console.log(`🤖 [AI] หุ่นยนต์ไม่ได้ส่งรอบมา ดึงรอบอัตโนมัติ: รอบที่ ${activeRoundReq.rows[0].round_number}`);
            } else {
                return res.json({ success: false, message: 'ไม่มีรอบที่รอออกผล' });
            }
        }

        // 1. ดึงบิลทั้งหมดของรอบนั้นมา (ตอนนี้ AI จะมองเห็นบิลลูกค้าแล้ว!)
        const ordersReq = await pgPool.query(`
            SELECT i.lottery_type, i.selected_number, i.price, o.currency_code
            FROM Yeeki_Order_Items i
            JOIN Yeeki_Orders o ON i.order_id = o.order_id
            WHERE o.round_id = $1
        `, [round_id]);
        
        const orders = ordersReq.rows;

        // 2. ดึงเรทเงินและอัตราจ่าย
        const exReq = await pgPool.query(`SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'`);
        const lakRate = exReq.rows[0]?.rate ? parseFloat(exReq.rows[0].rate) : 620;

        const ratesReq = await pgPool.query(`SELECT lottery_type, multiplier FROM Yeeki_Prize_Rates`);
        const prizeRates = {};
        ratesReq.rows.forEach(r => prizeRates[r.lottery_type] = parseFloat(r.multiplier));

        let totalSalesTHB = 0;
        
        // 3. จัดกลุ่มบิลลงตะกร้าเพื่อจำลอง 5,000 รอบ
        let bets = { t6: {}, t4: {}, t3: {}, tTode: {}, t2: {}, tRun: {}, b2: {}, bRun: {}, s8: {} };

        orders.forEach(o => {
            let thbPrice = (o.currency_code === 'LAK' || o.currency_code === '₭') ? (parseFloat(o.price) / lakRate) : parseFloat(o.price);
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
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 3. API: ประกาศผลและตรวจบิลจริง (Execute Draw) - Manual โดย Admin
// ==========================================
app.post('/api/admin/execute-yeeki-draw', async (req, res) => {
    // 🌟 รับมาแค่ 8 ตัว (Super) กับ 2 ตัวล่าง (ระบบหลังบ้านจะหั่นเลขอื่นๆ ออกมาเอง)
    const { round_id, super_number, bottom_2 } = req.body; 
    const client = await pgPool.connect(); // 🌟 เปิด Transaction
    
    try {
        await client.query('BEGIN');

        // 🌟 ให้ระบบหั่นเลขเอง เพื่อให้มั่นใจว่าเลขทุกตัว (6, 4, 3, 2 บน) สัมพันธ์กับเลข 8 ตัวแน่นอน
        const top_6 = super_number.slice(-6);
        const top_4 = super_number.slice(-4);
        const top_3 = super_number.slice(-3);
        const top_2 = super_number.slice(-2);

        // 🌟 บันทึกผลลง Database
        await client.query(`
            UPDATE Yeeki_Rounds 
            SET 
                result_8_super = $1, 
                result_6_top = $2, 
                result_4_top = $3, 
                result_3_top = $4, 
                result_2_bottom = $5, 
                status = 'Completed' 
            WHERE round_id = $6 AND category != 'THAI'
        `, [super_number, top_6, top_4, top_3, bottom_2, round_id]);

        const ratesReq = await client.query(`SELECT lottery_type, multiplier FROM Yeeki_Prize_Rates`);
        const prizeRates = {};
        ratesReq.rows.forEach(r => prizeRates[r.lottery_type] = parseFloat(r.multiplier));

        const itemsReq = await client.query(`
            SELECT i.item_id, i.order_id, i.lottery_type, i.selected_number, i.price, o.user_id, o.currency_code
            FROM Yeeki_Order_Items i
            JOIN Yeeki_Orders o ON i.order_id = o.order_id
            WHERE o.round_id = $1 AND i.status = 'รอผลตรวจ'
        `, [round_id]);
        const items = itemsReq.rows;

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
                const prizeAmount = parseFloat(item.price) * (prizeRates[type] || 0);
                
                // 1. อัปเดตสถานะบิลว่าถูกรางวัล
                await client.query(`UPDATE Yeeki_Order_Items SET status = 'ชนะ', prize_amount = $1 WHERE item_id = $2`, [prizeAmount, item.item_id]);
                
                // 2. เติมเงินเข้ากระเป๋า (🌟 อัปเดตทั้ง Users และ Wallets เพื่อความชัวร์ไม่ให้ระบบไหนบัค)
                await client.query(`UPDATE Users SET wallet_balance = COALESCE(wallet_balance, 0) + $1 WHERE user_id = $2`, [prizeAmount, item.user_id]);
                await client.query(`UPDATE Wallets SET balance = COALESCE(balance, 0) + $1 WHERE user_id = $2`, [prizeAmount, item.user_id]);
                
                // 3. สร้างประวัติ (Transaction) ให้ไปโชว์ที่หน้าแดชบอร์ด
                await client.query(`
                    INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                    VALUES ($1, $2, 'PRIZE_WIN', $3, 'Completed', CURRENT_TIMESTAMP)
                `, [item.user_id, prizeAmount, `ถูกรางวัล ${type} (${num}) รอบที่ ${round_id}`]);
            } else {
                await client.query(`UPDATE Yeeki_Order_Items SET status = 'แพ้', prize_amount = 0 WHERE item_id = $1`, [item.item_id]);
            }
        }
        await client.query('COMMIT');
        res.json({ success: true, message: "ประกาศผลและโอนเงินรางวัลเสร็จสิ้น!" });
    } catch (innerErr) { 
        await client.query('ROLLBACK'); 
        console.error("Execute Yeeki Draw Error:", innerErr);
        res.status(500).json({ success: false, message: `Database Error: ${innerErr.message}` }); 
    } finally {
        client.release();
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🤖 หุ่นยนต์ออกรางวัลอัตโนมัติ 24 ชม. (Auto-Draw Worker)
// ==========================================
// หุ่นยนต์จะตื่นมาทำงานทุกๆ 30 วินาที
setInterval(async () => {
    try {
        // 🌟 ดึงรอบที่เลยเวลาปิดรับแล้ว และยังไม่ได้ออกผล (ใช้เวลา Asia/Bangkok ของ Postgres)
        const pendingRounds = await pgPool.query(`
            SELECT round_id, round_number 
            FROM Yeeki_Rounds 
            WHERE draw_time <= CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok' 
            AND status != 'Completed'
        `);

        if (pendingRounds.rows.length === 0) return;

        const target_percent = 50; 
        const EXCHANGE_RATE = 620;

        for (let round of pendingRounds.rows) {
            console.log(`🤖 [AUTO] หุ่นยนต์กำลังออกรางวัลรอบที่ ${round.round_number} อัตโนมัติ...`);
            
            const ordersReq = await pgPool.query(`
                SELECT oi.item_id, oi.order_id, oi.lottery_type, oi.selected_number, oi.price, o.user_id, o.currency_code
                FROM Yeeki_Order_Items oi
                JOIN Yeeki_Orders o ON oi.order_id = o.order_id
                WHERE o.round_id = $1 AND oi.status = 'รอผลตรวจ'
            `, [round.round_id]);
            const items = ordersReq.rows;

            let super_number = String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
            let top_number = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
            let bottom_number = String(Math.floor(Math.random() * 100)).padStart(2, '0');

            const rates = { '8 ตัว (Super)': 1000000, '6 ตัว': 400000, '4 ตัวท้าย': 6000, '3 ตัวบน': 900, '3 ตัวโต๊ด': 150, '2 ตัวบน': 90, '2 ตัวล่าง': 90, 'วิ่งบน': 3.2, 'วิ่งล่าง': 4.2 };

            if (items.length > 0) {
                let totalSalesTHB = items.reduce((sum, item) => sum + ((item.currency_code === 'LAK' || item.currency_code === '₭') ? (parseFloat(item.price) / EXCHANGE_RATE) : parseFloat(item.price)), 0);
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
                        let priceTHB = (item.currency_code === 'LAK' || item.currency_code === '₭') ? (parseFloat(item.price) / EXCHANGE_RATE) : parseFloat(item.price);
                        let isWin = false; let num = item.selected_number;
                        
                        switch (item.lottery_type) {
                            case '8 ตัว (Super)': if (num === s8) isWin = true; break;
                            case '6 ตัว': if (num === s8.slice(-6)) isWin = true; break; 
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

            const client = await pgPool.connect();
            try {
                await client.query('BEGIN');
                
                let top6 = super_number.slice(-6);
                let top3 = top_number.slice(-3); 
                let top2 = top_number.slice(-2);

                // บันทึกผลรอบ
                await client.query(`
                    UPDATE Yeeki_Rounds 
                    SET result_8_super = $1, result_6_top = $2, result_4_top = $3, result_3_top = $4, result_2_bottom = $5, status = 'Completed' 
                    WHERE round_id = $6
                `, [super_number, top6, top_number, top3, bottom_number, round.round_id]);

                for (let item of items) {
                    let isWin = false; let num = item.selected_number;
                    switch (item.lottery_type) {
                        case '8 ตัว (Super)': if (num === super_number) isWin = true; break;
                        case '6 ตัว': if (num === top6) isWin = true; break; 
                        case '4 ตัวท้าย': if (num === top_number) isWin = true; break;
                        case '3 ตัวบน': if (num === top3) isWin = true; break;
                        case '3 ตัวโต๊ด': if (num.split('').sort().join('') === top3.split('').sort().join('')) isWin = true; break;
                        case '2 ตัวบน': if (num === top2) isWin = true; break;
                        case '2 ตัวล่าง': if (num === bottom_number) isWin = true; break;
                        case 'วิ่งบน': if (top3.includes(num)) isWin = true; break;
                        case 'วิ่งล่าง': if (bottom_number.includes(num)) isWin = true; break;
                    }

                    if (isWin) {
                        let prize = parseFloat(item.price) * (rates[item.lottery_type] || 0);
                        
                        await client.query(`UPDATE Yeeki_Order_Items SET status = 'Win', prize_amount = $1 WHERE item_id = $2`, [prize, item.item_id]);
                        
                        // เติมเงิน
                        await client.query(`UPDATE Users SET wallet_balance = COALESCE(wallet_balance, 0) + $1 WHERE user_id = $2`, [prize, item.user_id]);
                        await client.query(`UPDATE Wallets SET balance = COALESCE(balance, 0) + $1 WHERE user_id = $2`, [prize, item.user_id]);

                        await client.query(`
                            INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                            VALUES ($1, $2, 'PRIZE_WIN', $3, 'Completed', CURRENT_TIMESTAMP)
                        `, [item.user_id, prize, `ถูกรางวัล ${item.lottery_type} (${num}) รอบที่ ${round.round_number}`]);
                    } else {
                        await client.query(`UPDATE Yeeki_Order_Items SET status = 'Lose', prize_amount = 0 WHERE item_id = $1`, [item.item_id]);
                    }
                }
                
                await client.query(`UPDATE Yeeki_Orders SET status = 'Completed' WHERE round_id = $1`, [round.round_id]);
                await client.query('COMMIT');
                console.log(`✅ [AUTO] จ่ายเงินและสร้างประวัติรอบที่ ${round.round_number} สำเร็จแล้วแบบไร้รอยต่อ!`);
            } catch (innerErr) {
                await client.query('ROLLBACK');
                console.error(`❌ [AUTO] พังตอนแจกเงินรอบ ${round.round_number}:`, innerErr);
            } finally {
                client.release();
            }
        }
    } catch (err) {
        console.error("Auto draw interval error:", err);
    }
}, 30000);

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API 2: ค้นหาคนซื้อจากเลข (ด้านล่างสุด)
// ==========================================
app.post('/api/admin/search-buyers', async (req, res) => {
    const { number } = req.body;
    try {
        // ดึงเรทแลกเปลี่ยนปัจจุบัน
        const rateRes = await pgPool.query("SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'");
        const exchangeRate = rateRes.rows.length > 0 ? parseFloat(rateRes.rows[0].rate) : 500.0;

        // ดึงเวลาเปิด-ปิด ของระบบมาเช็ค
        const settingsRes = await pgPool.query("SELECT open_time, close_time FROM System_Settings LIMIT 1");
        if (settingsRes.rows.length === 0) return res.status(500).json({ success: false, message: 'ไม่พบการตั้งค่าเวลา' });
        
        const openTime = settingsRes.rows[0].open_time;
        const closeTime = settingsRes.rows[0].close_time;

        const result = await pgPool.query(`
                WITH TimeCalc AS (
                    SELECT 
                        CASE 
                            WHEN CAST($2 AS TIME) > CAST($3 AS TIME) 
                            THEN CAST(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok' - INTERVAL '1 day' AS DATE) + CAST($2 AS TIME)
                            ELSE CAST(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok' AS DATE) + CAST($2 AS TIME)
                        END as "StartDateTime",
                        CAST(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok' AS DATE) + CAST($3 AS TIME) as "EndDateTime"
                )
                SELECT 
                    u.username, o.currency_code, i.price, CAST(i.lottery_type AS VARCHAR) as lottery_type, i.selected_number, o.created_at,
                    (i.price * r.multiplier) as estimated_prize,
                    CASE 
                        WHEN o.currency_code = 'LAK' THEN (i.price * r.multiplier) / $4 
                        ELSE (i.price * r.multiplier) 
                    END as estimated_prize_thb
                FROM Lottery_Order_Items i
                JOIN Lottery_Orders o ON i.order_id = o.order_id
                JOIN Users u ON o.user_id = u.user_id
                LEFT JOIN Lottery_Prize_Rates r ON CAST(i.lottery_type AS VARCHAR) = CAST(r.lottery_type AS VARCHAR)
                CROSS JOIN TimeCalc tc
                WHERE i.selected_number = $1
                  AND o.created_at >= tc."StartDateTime" 
                  AND o.created_at <= tc."EndDateTime"
                ORDER BY i.price DESC
            `, [number, openTime, closeTime, exchangeRate]
        );
        res.json({ success: true, buyers: result.rows });
    } catch (err) { 
        console.error(err);
        res.status(500).json({ success: false }); 
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API 1: จำลองคนถูกรางวัล (แสดงใน Modal)
// ==========================================
app.post('/api/admin/simulate-winners', async (req, res) => {
    const { number, lottery_type } = req.body;
    try {
        // ดึงเรทแลกเปลี่ยนปัจจุบัน
        const rateRes = await pgPool.query("SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'");
        const exchangeRate = rateRes.rows.length > 0 ? parseFloat(rateRes.rows[0].rate) : 500.0;

        const result = await pgPool.query(`
                SELECT 
                    u.username, o.currency_code, i.price, CAST(i.lottery_type AS VARCHAR) as lottery_type, i.selected_number,
                    (i.price * r.multiplier) as estimated_prize,
                    CASE 
                        WHEN o.currency_code = 'LAK' THEN (i.price * r.multiplier) / $1 
                        ELSE (i.price * r.multiplier) 
                    END as estimated_prize_thb
                FROM Lottery_Order_Items i
                JOIN Lottery_Orders o ON i.order_id = o.order_id
                JOIN Users u ON o.user_id = u.user_id
                LEFT JOIN Lottery_Prize_Rates r ON CAST(i.lottery_type AS VARCHAR) = CAST(r.lottery_type AS VARCHAR)
                WHERE o.status = 'รอผลตรวจ' AND i.status = 'รอผลตรวจ'
                  AND CAST(i.lottery_type AS VARCHAR) = $2 AND i.selected_number = $3
            `, [exchangeRate, lottery_type, number]
        );
        res.json({ success: true, users: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API: จัดการตั้งค่า % Commission
// ==========================================

// 1. ดึงข้อมูลการตั้งค่า Commission ปัจจุบัน
app.get('/api/admin/commission-settings', async (req, res) => {
    try {
        const result = await pgPool.query('SELECT * FROM Commission_Settings WHERE id = 1');
        
        if (result.rows.length > 0) {
            res.json({ success: true, data: result.rows[0] });
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
        await pgPool.query(`
                UPDATE Commission_Settings 
                SET purchase_percent = $1, 
                    win_percent = $2, 
                    daily_bonus_percent = $3,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = 1
            `, [purchase_percent, win_percent, daily_bonus_percent]
        );
            
        res.json({ success: true, message: 'อัปเดตอัตรา Commission สำเร็จ' });
    } catch (err) {
        console.error('Update Commission Settings Error:', err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการอัปเดต' });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API: ดึงข้อมูลหน้าทีม (ส่งค่า % จาก Admin ไปให้หน้าบ้านแสดงผล)
// ==========================================
app.get('/api/my-team/:uid', async (req, res) => {
    try {
        const userId = req.params.uid;
        
        // 1. ดึงชื่อและสกุลเงินตัวเอง (ผู้แนะนำ)
        const userRes = await pgPool.query('SELECT username, currency_code FROM Users WHERE user_id = $1', [userId]);
        if (userRes.rows.length === 0) return res.json({ success: false, message: 'User not found' });
        const myUsername = userRes.rows[0].username.trim();
        const myCurrency = userRes.rows[0].currency_code || 'THB';

        // 2. ดึงข้อมูลลูกทีม
        const teamRes = await pgPool.query(`
            SELECT 
                user_id, username, created_at, is_active, COALESCE(currency_code, 'THB') as currency_code,
                COALESCE(total_purchase_comm, 0) as total_purchase_comm, 
                COALESCE(total_win_comm, 0) as total_win_comm 
            FROM Users WHERE referrer_username = $1
        `, [myUsername]);

        // 3. ดึงประวัติการเงินทั้งหมดของเรา
        const transRes = await pgPool.query(`
            SELECT amount, title, created_at FROM Transactions WHERE user_id = $1
        `, [userId]);
        
        // 🌟 4. ดึงเรทการตั้งค่าทั้งหมด (เพื่อส่งไปแสดงผล % ที่หน้าบ้านให้ตรงกับที่ Admin ตั้ง)
        const setRes = await pgPool.query('SELECT purchase_percent, win_percent, daily_bonus_percent FROM Commission_Settings LIMIT 1');
        const commSettings = setRes.rows.length > 0 ? setRes.rows[0] : { purchase_percent: 2, win_percent: 2, daily_bonus_percent: 1 };

        // 5. ดึงตารางอัตราแลกเปลี่ยนทั้งหมด
        const exRes = await pgPool.query('SELECT currency_pair, rate FROM ExchangeRates');
        const exchangeRates = {};
        exRes.rows.forEach(r => {
            exchangeRates[r.currency_pair] = parseFloat(r.rate); // 🌟 แปลงเรทเป็นตัวเลขกันเหนียวเผื่อ DB คืนมาเป็น String
        });

        res.json({
            success: true,
            myUsername: myUsername,
            myCurrency: myCurrency,
            teamMembers: teamRes.rows,
            transactions: transRes.rows,
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
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API: รายงานโอนเงินรางวัลและสรุปกำไร (Prize Transfer Report)
// ==========================================
app.post('/api/admin/prize-report', async (req, res) => {
    const { startDate, endDate, country } = req.body;
    try {
        // 1. ดึงเรทแลกเปลี่ยนปัจจุบัน (เพื่อใช้แปลง LAK เป็น THB สำหรับสรุปยอด)
        const rateRes = await pgPool.query("SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'");
        const exchangeRate = rateRes.rows.length > 0 ? parseFloat(rateRes.rows[0].rate) : 500.0;

        // 2. Query ดึงข้อมูลสรุปของ "เดือนปัจจุบัน" (สะสม)
        const monthlyQuery = `
            SELECT 
                COALESCE(SUM(CASE WHEN o.currency_code = 'LAK' THEN o.total_amount / $1 ELSE o.total_amount END), 0) as monthly_sales,
                COALESCE((
                    SELECT SUM(CASE WHEN o2.currency_code = 'LAK' THEN i2.prize_amount / $1 ELSE i2.prize_amount END)
                    FROM Lottery_Order_Items i2 
                    JOIN Lottery_Orders o2 ON i2.order_id = o2.order_id
                    WHERE i2.status = 'ถูกรางวัล' AND EXTRACT(MONTH FROM o2.created_at) = EXTRACT(MONTH FROM CURRENT_TIMESTAMP) AND EXTRACT(YEAR FROM o2.created_at) = EXTRACT(YEAR FROM CURRENT_TIMESTAMP)
                ), 0) as monthly_prizes
            FROM Lottery_Orders o
            WHERE EXTRACT(MONTH FROM o.created_at) = EXTRACT(MONTH FROM CURRENT_TIMESTAMP) AND EXTRACT(YEAR FROM o.created_at) = EXTRACT(YEAR FROM CURRENT_TIMESTAMP);
        `;
        const monthlyRes = await pgPool.query(monthlyQuery, [exchangeRate]);
        const monthlySales = monthlyRes.rows[0].monthly_sales;
        const monthlyProfit = monthlySales - monthlyRes.rows[0].monthly_prizes;

        // 3. Query ดึงข้อมูล "ตามช่วงเวลาและประเทศที่เลือก"
        let countryCondition = "";
        if (country === 'Thailand') countryCondition = "AND u.country = 'Thailand'";
        if (country === 'Laos') countryCondition = "AND u.country = 'Laos'";

        const filterSummaryQuery = `
            SELECT 
                COALESCE(SUM(CASE WHEN o.currency_code = 'LAK' THEN o.total_amount / $1 ELSE o.total_amount END), 0) as period_sales,
                COALESCE((
                    SELECT SUM(CASE WHEN o2.currency_code = 'LAK' THEN i2.prize_amount / $1 ELSE i2.prize_amount END)
                    FROM Lottery_Order_Items i2 
                    JOIN Lottery_Orders o2 ON i2.order_id = o2.order_id
                    JOIN Users u2 ON o2.user_id = u2.user_id
                    WHERE i2.status = 'ถูกรางวัล' AND CAST(o2.created_at AS DATE) BETWEEN CAST($2 AS DATE) AND CAST($3 AS DATE) ${countryCondition.replace(/u\./g, 'u2.')}
                ), 0) as period_prizes
            FROM Lottery_Orders o
            JOIN Users u ON o.user_id = u.user_id
            WHERE CAST(o.created_at AS DATE) BETWEEN CAST($2 AS DATE) AND CAST($3 AS DATE) ${countryCondition};
        `;
        const summaryRes = await pgPool.query(filterSummaryQuery, [exchangeRate, startDate, endDate]);
        
        const periodSales = summaryRes.rows[0].period_sales;
        const periodPrizes = summaryRes.rows[0].period_prizes;
        const periodProfit = periodSales - periodPrizes;

        // 4. Query ดึงรายชื่อ "ผู้ถูกรางวัล" ตามเงื่อนไข
        const winnersQuery = `
            SELECT 
                u.username, u.country, o.currency_code, 
                i.lottery_type, i.selected_number, i.price, i.prize_amount, o.created_at,
                CASE WHEN o.currency_code = 'LAK' THEN i.prize_amount / $1 ELSE i.prize_amount END as prize_thb
            FROM Lottery_Order_Items i
            JOIN Lottery_Orders o ON i.order_id = o.order_id
            JOIN Users u ON o.user_id = u.user_id
            WHERE i.status = 'ถูกรางวัล' 
            AND CAST(o.created_at AS DATE) BETWEEN CAST($2 AS DATE) AND CAST($3 AS DATE)
            ${countryCondition}
            ORDER BY o.created_at DESC;
        `;
        const winnersRes = await pgPool.query(winnersQuery, [exchangeRate, startDate, endDate]);

        res.json({
            success: true,
            monthly: { sales: monthlySales, profit: monthlyProfit },
            period: { sales: periodSales, prizes: periodPrizes, profit: periodProfit },
            winners: winnersRes.rows
        });

    } catch (err) {
        console.error("Prize Report Error:", err);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🛡️ API: ระบบจัดการ IP เฝ้าระวัง
// ==========================================

// ดึงรายการ IP ที่ถูกบล็อกหรือเฝ้าระวัง
app.get('/api/admin/malicious-ips', async (req, res) => {
    try {
        const result = await pgPool.query(`
            SELECT id, ip_address, reason, is_blocked, created_at 
            FROM Blocked_IPs 
            ORDER BY created_at DESC
        `);
        res.json({ success: true, ips: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// ปลดบล็อก / หรือบล็อก IP แบบ Manual
app.post('/api/admin/toggle-block-ip', async (req, res) => {
    const { ip_address, is_blocked, reason } = req.body;
    try {
        if (is_blocked) {
            // สั่งบล็อก Manual
            const checkReq = await pgPool.query(`SELECT 1 FROM Blocked_IPs WHERE ip_address = $1`, [ip_address]);
            
            if (checkReq.rows.length > 0) {
                await pgPool.query(`
                    UPDATE Blocked_IPs 
                    SET is_blocked = '1', reason = $1, updated_at = CURRENT_TIMESTAMP 
                    WHERE ip_address = $2
                `, [reason || 'Manual Block', ip_address]);
            } else {
                await pgPool.query(`
                    INSERT INTO Blocked_IPs (ip_address, reason, is_blocked) 
                    VALUES ($1, $2, '1')
                `, [ip_address, reason || 'Manual Block']);
            }
        } else {
            // สั่งปลดบล็อก
            await pgPool.query(`UPDATE Blocked_IPs SET is_blocked = '0', updated_at = CURRENT_TIMESTAMP WHERE ip_address = $1`, [ip_address]);
            
            // ล้างประวัติการ Login ผิดพลาดให้ด้วย
            await pgPool.query(`DELETE FROM Login_Failed_Attempts WHERE ip_address = $1`, [ip_address]);
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🏢 API: ระบบจัดการข้อมูลองค์กร (HRM Master Data)
// ==========================================

// 1. ดึงข้อมูลทั้งหมด (Branches, Departments, Positions)
app.get('/api/hrm/master-data', async (req, res) => {
    try {
        const branchRes = await pgPool.query('SELECT * FROM Emp_Branches');
        const deptRes = await pgPool.query('SELECT * FROM Emp_Departments');
        const posRes = await pgPool.query('SELECT * FROM Emp_Positions');

        res.json({
            success: true,
            branches: branchRes.rows,
            departments: deptRes.rows,
            positions: posRes.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🏢 API: จัดการข้อมูล สาขา (เพิ่ม/อัปเดต) + Auto Gen รหัส
// ==========================================
app.post('/api/hrm/branch', async (req, res) => {
    let { branch_code, branch_name, country_code } = req.body;
    try {
        // 🌟 ถ้าไม่มี branch_code ส่งมา (แปลว่าสร้างสาขาใหม่) ให้ Auto-Gen รหัส
        if (!branch_code) {
            const countRes = await pgPool.query('SELECT CAST(COUNT(*) AS INTEGER) as cnt FROM Emp_Branches');
            const nextNum = (countRes.rows[0].cnt + 1).toString().padStart(2, '0');
            branch_code = `B${nextNum}`; // ผลลัพธ์ เช่น B01, B02
            
            await pgPool.query(`
                INSERT INTO Emp_Branches (branch_code, branch_name, country_code) 
                VALUES ($1, $2, $3)
            `, [branch_code, branch_name, country_code]);
        } else {
            // 🌟 ถ้ามีรหัสมา แปลว่าอัปเดตข้อมูลสาขาเดิม
            await pgPool.query(`
                UPDATE Emp_Branches 
                SET branch_name = $1, country_code = $2 
                WHERE branch_code = $3
            `, [branch_name, country_code, branch_code]);
        }
        res.json({ success: true, new_code: branch_code });
    } catch (err) {
        console.error("Branch API Error:", err);
        res.status(500).json({ success: false, message: 'SQL Error: ' + err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🏢 API: จัดการข้อมูล แผนก (เพิ่ม/อัปเดต) + Auto Gen รหัส
// ==========================================
app.post('/api/hrm/department', async (req, res) => {
    let { dept_code, dept_name } = req.body;
    try {
        // 🌟 ถ้าไม่มี dept_code ส่งมา (แปลว่าสร้างใหม่) ให้ Auto-Gen
        if (!dept_code) {
            const countRes = await pgPool.query('SELECT CAST(COUNT(*) AS INTEGER) as cnt FROM Emp_Departments');
            const nextNum = (countRes.rows[0].cnt + 1).toString().padStart(2, '0');
            dept_code = `D${nextNum}`; // ผลลัพธ์ เช่น D01, D02
            
            await pgPool.query(`
                INSERT INTO Emp_Departments (dept_code, dept_name) 
                VALUES ($1, $2)
            `, [dept_code, dept_name]);
        } else {
            // 🌟 ถ้ามีรหัสมา แปลว่าอัปเดต
            await pgPool.query(`
                UPDATE Emp_Departments 
                SET dept_name = $1 
                WHERE dept_code = $2
            `, [dept_name, dept_code]);
        }
        res.json({ success: true, new_code: dept_code });
    } catch (err) {
        console.error("Department API Error:", err);
        res.status(500).json({ success: false, message: 'SQL Error: ' + err.message });
    }
});
// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🏢 API: จัดการข้อมูล ตำแหน่ง (เพิ่ม/อัปเดต) + Auto Gen รหัส + Job Responsibilities
// ==========================================
app.post('/api/hrm/position', async (req, res) => {
    let { position_code, position_name, dept_code, base_salary, job_responsibilities } = req.body;
    try {
        const baseSal = parseFloat(base_salary) || 0;
        const jobResp = job_responsibilities || ''; // 🌟 รับค่าความรับผิดชอบมาด้วย

        if (!position_code) {
            // สร้างใหม่
            const lastPos = await pgPool.query(`SELECT position_code FROM Emp_Positions WHERE dept_code = $1 ORDER BY position_code DESC LIMIT 1`, [dept_code]);
            let nextNum = 1;
            if (lastPos.rows.length > 0) {
                const lastCode = lastPos.rows[0].position_code;
                const parts = lastCode.split('-P');
                if(parts.length === 2) nextNum = parseInt(parts[1], 10) + 1;
            }
            position_code = `${dept_code}-P${nextNum.toString().padStart(2, '0')}`;
            
            await pgPool.query(`
                INSERT INTO Emp_Positions (position_code, position_name, dept_code, base_salary, job_responsibilities) 
                VALUES ($1, $2, $3, $4, $5)
            `, [position_code, position_name, dept_code, baseSal, jobResp]);
        } else {
            // อัปเดต
            await pgPool.query(`
                UPDATE Emp_Positions 
                SET position_name = $1, dept_code = $2, base_salary = $3, job_responsibilities = $4 
                WHERE position_code = $5
            `, [position_name, dept_code, baseSal, jobResp, position_code]);
        }
        res.json({ success: true, new_code: position_code });
    } catch (err) {
        console.error("Position API Error:", err);
        res.status(500).json({ success: false, message: 'SQL Error: ' + err.message });
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🧑‍💼 API: สำหรับลูกค้ายื่นใบสมัครงาน (ฟอร์มชุดใหญ่จัดเต็ม!)
// ==========================================
app.post('/api/hrm/apply-job', async (req, res) => {
    // 🌟 รับค่าที่เจ้านายรีเควสมาทั้งหมด
    const { 
        username, firstname, lastname, branch_code, position_code, employment_type,
        expected_salary, special_skills, why_hire_you, 
        education_doc_url, profile_pic_url // 2 ตัวนี้จะรับเป็น Base64 String
    } = req.body;
    
    if(!username || !firstname || !branch_code || !position_code) {
        return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน' });
    }

    try {
        // 1. เช็คว่าเคยยื่นสมัครไปยัง?
        const checkExist = await pgPool.query(`SELECT emp_code FROM Employees WHERE username = $1 AND status = 'Pending'`, [username]);
        if(checkExist.rows.length > 0) return res.status(400).json({ success: false, message: 'คุณได้ยื่นใบสมัครไปแล้ว กรุณารอการติดต่อกลับครับ' });

        // 2. สร้างรหัสใบสมัคร
        const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,'');
        const countRes = await pgPool.query(`SELECT CAST(COUNT(emp_code) AS INTEGER) as cnt FROM Employees`);
        const nextId = (countRes.rows[0].cnt + 1).toString().padStart(4, '0');
        const emp_code = `APP-${dateStr}-${nextId}`;

        // 3. บันทึกลงตาราง (รวมฟิลด์ใหม่ๆ ทั้งหมด)
        await pgPool.query(`
            INSERT INTO Employees (
                emp_code, username, password_hash, firstname, lastname, branch_code, position_code, employment_type, status, created_at,
                expected_salary, special_skills, why_hire_you, education_doc_url, profile_pic_url
            )
            VALUES (
                $1, $2, 'USE_MAIN_LOGIN', $3, $4, $5, $6, $7, 'Pending', CURRENT_TIMESTAMP,
                $8, $9, $10, $11, $12
            )
        `, [
            emp_code, username, firstname, lastname || '', branch_code, position_code, employment_type, 
            parseFloat(expected_salary) || 0, special_skills || '', why_hire_you || '', education_doc_url || '', profile_pic_url || ''
        ]);
            
        res.json({ success: true, message: 'ส่งใบสมัครเรียบร้อยแล้ว!' });
    } catch (err) {
        console.error("Apply Job Error:", err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🧑‍💼 API: Admin ดึงรายชื่อผู้สมัครงานทั้งหมด (ดึงเฉพาะคนที่สถานะยังเป็น Pending)
// ==========================================
app.get('/api/hrm/applicants', async (req, res) => {
    try {
        // ดึงข้อมูลผู้สมัคร พร้อมดึงชื่อตำแหน่งและชื่อแผนกมาโชว์ด้วย
        const result = await pgPool.query(`
            SELECT 
                e.emp_code, e.username, e.firstname, e.lastname, e.employment_type, 
                e.status, e.created_at, e.expected_salary, e.special_skills, e.why_hire_you,
                e.education_doc_url, e.profile_pic_url,
                p.position_code, p.position_name,
                d.dept_code, d.dept_name
            FROM Employees e
            LEFT JOIN Emp_Positions p ON e.position_code = p.position_code
            LEFT JOIN Emp_Departments d ON e.branch_code = d.dept_code -- สมมติว่าเก็บ branch_code เป็น dept_code ชั่วคราว (หรือ join ให้ถูกตามโครงสร้าง)
            WHERE e.status IN ('Pending', 'Approved', 'Rejected')
            ORDER BY e.created_at DESC
        `);

        // จัดกลุ่มข้อมูลตาม "รหัสตำแหน่ง" (position_code) ให้ง่ายต่อการทำ Tabs หน้าเว็บ
        const groupedByPosition = result.rows.reduce((acc, applicant) => {
            const posCode = applicant.position_code || 'Unknown';
            if (!acc[posCode]) {
                acc[posCode] = {
                    position_name: applicant.position_name || 'ไม่ระบุตำแหน่ง',
                    dept_name: applicant.dept_name || 'ไม่ระบุแผนก',
                    applicants: []
                };
            }
            acc[posCode].applicants.push(applicant);
            return acc;
        }, {});

        res.json({ success: true, groupedApplicants: groupedByPosition });
    } catch (err) {
        console.error("Fetch Applicants Error:", err);
        res.status(500).json({ success: false, message: 'SQL Error: ' + err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🧑‍💼 API: Admin อัปเดตสถานะใบสมัคร (ผ่าน/ไม่ผ่าน) + ส่งแจ้งเตือน (แก้บั๊ก id)
// ==========================================
app.post('/api/hrm/applicants/update-status', async (req, res) => {
    const { emp_code, status, reply_message } = req.body;
    try {
        // 1. ดึง username ของผู้สมัครคนนี้ออกมาก่อน
        const empRes = await pgPool.query(`SELECT username FROM Employees WHERE emp_code = $1`, [emp_code]);
            
        if (empRes.rows.length === 0) {
             return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลผู้สมัคร' });
        }
        
        const applicantUsername = empRes.rows[0].username;

        // 2. อัปเดตสถานะในตาราง Employees
        await pgPool.query(`UPDATE Employees SET status = $1 WHERE emp_code = $2`, [status, emp_code]);
            
        // 3. บันทึกข้อความตอบกลับลงระบบ Notification
        const userRes = await pgPool.query(`SELECT * FROM users WHERE username = $1`, [applicantUsername]); 

        if (userRes.rows.length > 0) {
            // 🌟 ดึงค่า user_id จาก rows
            const userId = userRes.rows[0].user_id; 
            const notifTitle = status === 'Approved' ? '🎉 ยินดีด้วย! ใบสมัครผ่านการคัดเลือก' : 'แจ้งผลการสมัครงาน';
            
            await pgPool.query(`
                INSERT INTO Notifications (user_id, title, message, is_read, created_at) 
                VALUES ($1, $2, $3, '0', CURRENT_TIMESTAMP)
            `, [userId, notifTitle, reply_message]);
        } else {
             console.log("⚠️ หา User ไม่เจอสำหรับ Username:", applicantUsername);
        }

        res.json({ success: true });
    } catch (err) {
        console.error("Update Applicant Status Error:", err);
        res.status(500).json({ success: false, message: 'SQL Error: ' + err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 📣 API: ดึงข้อมูลโฆษณา (ให้หน้า PreLogin หรือ JobApplication เรียกใช้)
// ==========================================
app.get('/api/hrm/job-ad', async (req, res) => {
    try {
        const result = await pgPool.query(`
            SELECT * FROM Job_Ads_Settings 
            WHERE id = 1 AND is_active = '1'
            AND (start_time IS NULL OR start_time <= CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')
            AND (end_time IS NULL OR end_time >= CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')
        `);
        
        if(result.rows.length > 0) {
            const ad = result.rows[0];
            
            // 🌟 1. ดึงตำแหน่งที่อนุญาตให้สมัคร
            let allowedPos = [];
            if(ad.allowed_positions) {
                allowedPos = ad.allowed_positions.split(',').map(p => p.trim());
            }

            // 🌟 2. ดึงรายละเอียดของตำแหน่งเหล่านั้นส่งไปด้วย
            let activePositions = [];
            if (allowedPos.length > 0) {
                // สร้าง IN clause เช่น 'D01-P01','D02-P02' (คงโครงสร้างเดิมเพื่อให้โค้ดหน้าบ้านทำงานได้ 100%)
                const inClause = allowedPos.map(p => `'${p}'`).join(',');
                const posRes = await pgPool.query(`
                    SELECT p.position_code, p.position_name, p.dept_code, p.base_salary, p.job_responsibilities, d.dept_name
                    FROM Emp_Positions p
                    LEFT JOIN Emp_Departments d ON p.dept_code = d.dept_code
                    WHERE p.position_code IN (${inClause})
                `);
                activePositions = posRes.rows;
            }

            res.json({ success: true, ad: ad, activePositions: activePositions });
        } else {
            res.json({ success: false });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});
// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 📣 API: อัปเดตโฆษณา (แอดมินกดบันทึกจากหลังบ้าน)
// ==========================================
app.post('/api/hrm/job-ad', async (req, res) => {
    const { is_active, ad_title, ad_description, start_time, end_time, allowed_positions } = req.body;
    try {
        // แปลง Array เป็น String คั่นด้วยจุลภาค เช่น "D01-P01,D02-P01"
        const posString = Array.isArray(allowed_positions) ? allowed_positions.join(',') : '';

        await pgPool.query(`
                UPDATE Job_Ads_Settings 
                SET is_active = $1, ad_title = $2, ad_description = $3, 
                    start_time = $4, end_time = $5, allowed_positions = $6
                WHERE id = 1
            `, [is_active ? '1' : '0', ad_title, ad_description, start_time || null, end_time || null, posString]
        );
            
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 📣 API: ดึงข้อมูลโฆษณาทั้งหมด (สำหรับหน้า Admin)
// ==========================================
app.get('/api/hrm/job-ad/admin', async (req, res) => {
    try {
        // ดึงมาทั้งหมด เรียงจากใหม่ไปเก่า
        const result = await pgPool.query(`
            SELECT * FROM Job_Ads_Settings ORDER BY id DESC
        `);
        res.json({ success: true, ads: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 📣 API: เพิ่ม / แก้ไข โฆษณา (ทับซ้อนกับตัวบนตามโค้ดต้นฉบับ)
// ==========================================
app.post('/api/hrm/job-ad', async (req, res) => {
    const { id, is_active, ad_title, ad_description, start_time, end_time, allowed_positions } = req.body;
    try {
        const posString = Array.isArray(allowed_positions) ? allowed_positions.join(',') : '';

        if (id) {
            // 🌟 ถ้าส่ง ID มาแปลว่า "แก้ไขของเดิม"
            await pgPool.query(`
                    UPDATE Job_Ads_Settings 
                    SET is_active = $1, ad_title = $2, ad_description = $3, 
                        start_time = $4, end_time = $5, allowed_positions = $6
                    WHERE id = $7
                `, [is_active ? '1' : '0', ad_title, ad_description, start_time || null, end_time || null, posString, id]
            );
        } else {
            // 🌟 ถ้าไม่มี ID แปลว่า "สร้างโพสต์ใหม่"
            await pgPool.query(`
                    INSERT INTO Job_Ads_Settings (is_active, ad_title, ad_description, start_time, end_time, allowed_positions) 
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [is_active ? '1' : '0', ad_title, ad_description, start_time || null, end_time || null, posString]
            );
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});
// ==========================================
// 🌟 สิ้นสุด  HRM 
// ==========================================

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 2. ดึงข้อมูล 24 รอบของวันนี้ (ทั้งหน้าบ้านและหลังบ้านใช้ร่วมกัน)
// ==========================================
app.get('/api/yeeki/rounds', async (req, res) => {
    try {
        // 🌟 ดึงข้อมูลรอบของวันนี้ (อิงเวลาไทย) และแปลงเวลาให้ JavaScript ฝั่ง Frontend อ่านได้เป๊ะๆ
        const result = await pgPool.query(`
            SELECT 
                round_id, 
                round_number,
                to_char(open_time, 'YYYY-MM-DD HH24:MI:SS') as open_time,
                to_char(close_time, 'YYYY-MM-DD HH24:MI:SS') as close_time,
                to_char(draw_time, 'YYYY-MM-DD HH24:MI:SS') as draw_time,
                status
            FROM Yeeki_Rounds 
            WHERE CAST(draw_date AS DATE) = CAST(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok' AS DATE) 
            ORDER BY round_number ASC
        `);
        
        res.json({ success: true, rounds: result.rows });
    } catch (err) {
        console.error("Error fetching Yeeki rounds:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 2. ดึงอัตราการจ่าย (หวยยี่กี)
// ==========================================
app.get('/api/yeeki/prize-rates', async (req, res) => {
    try {
        const result = await pgPool.query('SELECT lottery_type, multiplier FROM Yeeki_Prize_Rates');
        res.json({ success: true, rates: result.rows });
    } catch (err) {
        console.error("Error fetching prize rates:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 3. ดึงยอดแจ็คพอต 8 ตัวสะสม (หวยยี่กี)
// ==========================================
app.get('/api/yeeki/jackpot', async (req, res) => {
    try {
        const result = await pgPool.query('SELECT * FROM Super_Yeeki_Jackpot ORDER BY id DESC LIMIT 1');
        
        if (result.rows.length > 0) {
             res.json({ success: true, jackpot: { current_amount: result.rows[0].amount, currency_code: 'LAK' } });
        } else {
             res.json({ success: true, jackpot: { current_amount: 10000000, currency_code: 'LAK' } });
        }
    } catch (err) {
        console.error("Error fetching jackpot:", err);
        res.json({ success: true, jackpot: { current_amount: 10000000, currency_code: 'LAK' } });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 รายงานยอดขายหวยยี่กี (Admin Sales Report - โชว์การ์ด 12 รอบถัดไปเสมอ)
// ==========================================
app.get('/api/admin/yeeki/sales-report', async (req, res) => {
    try {
        // 1. ดึง 12 รอบถัดไป (ข้ามวันได้) มาทำการ์ด
        const roundsResult = await pgPool.query(`
            SELECT 
                round_id, round_number, 
                to_char(open_time, 'YYYY-MM-DD HH24:MI:SS') as open_time_str, 
                to_char(close_time, 'YYYY-MM-DD HH24:MI:SS') as close_time_str, 
                to_char(draw_time, 'YYYY-MM-DD HH24:MI:SS') as draw_time_str,
                status as db_status,
                result_8_super, result_4_top, result_2_bottom
            FROM Yeeki_Rounds
            WHERE draw_time >= CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok'
            ORDER BY draw_date ASC, round_number ASC
            LIMIT 12
        `);
        
        // 2. ดึงบิลทั้งหมดเฉพาะที่อยู่ใน 12 รอบนี้
        const ordersResult = await pgPool.query(`
            SELECT 
                o.round_id, u.username, oi.lottery_type as type, oi.selected_number as number,
                oi.price, o.currency_code as currency, oi.status
            FROM Yeeki_Orders o
            JOIN Yeeki_Order_Items oi ON o.order_id = oi.order_id
            JOIN Users u ON o.user_id = u.user_id
            WHERE o.round_id IN (
                SELECT round_id
                FROM Yeeki_Rounds
                WHERE draw_time >= CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok'
                ORDER BY draw_date ASC, round_number ASC
                LIMIT 12
            )
            ORDER BY o.created_at DESC
        `);
        
        const allOrders = ordersResult.rows;
        let overallTotal = { thb: 0, lak: 0 };
        let activeRoundTotal = { thb: 0, lak: 0 };
        const jsNow = new Date(); 
        
        const rounds = roundsResult.rows.map(r => {
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
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API สำหรับการซื้อหวยยี่กี (แก้ไขชื่อคอลัมน์เป็น title)
// ==========================================
app.post('/api/yeeki/buy', async (req, res) => {
    const { user_id, cart, total_price, currency, note, lottery_category } = req.body;
    const client = await pgPool.connect(); // ใช้ Transaction
    
    try {
        if (!user_id || !cart || cart.length === 0) {
            return res.status(400).json({ success: false, message: "ข้อมูลการสั่งซื้อไม่ครบถ้วน" });
        }

        // 1. ดึงข้อมูลผู้ซื้อ 
        const userCheck = await client.query(`SELECT username, wallet_balance, referrer_username FROM Users WHERE user_id = $1`, [user_id]);
            
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ success: false, message: "ไม่พบข้อมูลผู้ใช้" });
        }
        
        const buyer = userCheck.rows[0];
        const currentBalance = parseFloat(buyer.wallet_balance) || 0;
        
        if (currentBalance < parseFloat(total_price)) {
            return res.status(400).json({ success: false, message: "ยอดเงินในกระเป๋าไม่เพียงพอ" });
        }

        await client.query('BEGIN');

        try {
            // 2. หักเงินผู้ซื้อ
            await client.query(`UPDATE Users SET wallet_balance = COALESCE(wallet_balance, 0) - $1 WHERE user_id = $2`, [total_price, user_id]);

            // 3. สร้างประวัติ Transaction ผู้ซื้อ (เปลี่ยน description เป็น title)
            await client.query(`
                INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at)
                VALUES ($1, $2, $3, $4, 'Completed', CURRENT_TIMESTAMP)
            `, [user_id, -parseFloat(total_price), 'BUY_YEEKI', `แทงหวยยี่กี รอบที่ ${cart[0].round_number}`]);

            // 4. บันทึกบิลหลักลง Yeeki_Orders
            const mainRoundId = cart[0].round_id;
            const insertOrderReq = await client.query(`
                INSERT INTO Yeeki_Orders (user_id, round_id, total_amount, currency_code, status, order_note, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
                RETURNING order_id
            `, [user_id, mainRoundId, total_price, currency, 'Completed', note || '']);

            const newOrderId = insertOrderReq.rows[0].order_id;

            // 5. บันทึกรายการย่อยทีละตัว
            for (let item of cart) {
                await client.query(`
                    INSERT INTO Yeeki_Order_Items (order_id, lottery_type, selected_number, price, status)
                    VALUES ($1, $2, $3, $4, 'รอผลตรวจ')
                `, [newOrderId, item.type, item.number, item.price]);
            }

            // 6. 💰 ระบบแจกค่าคอมมิชชั่น 5% ให้ผู้แนะนำ
            if (buyer.referrer_username) {
                // 6.1 เอาชื่อผู้แนะนำ ไปค้นหา user_id ในตาราง Users ก่อน
                const refCheck = await client.query(`SELECT user_id FROM Users WHERE username = $1`, [buyer.referrer_username]);

                // ถ้าเจอตัวผู้แนะนำในระบบ ค่อยจ่ายเงิน
                if (refCheck.rows.length > 0) {
                    const referrerUserId = refCheck.rows[0].user_id;
                    const commissionRate = 0.05; // เรท 5%
                    const commissionAmount = parseFloat(total_price) * commissionRate;

                    // 6.2 อัปเดตกระเป๋าเงินของผู้แนะนำ (บวกเงินเพิ่ม)
                    await client.query(`UPDATE Users SET wallet_balance = COALESCE(wallet_balance, 0) + $1 WHERE user_id = $2`, [commissionAmount, referrerUserId]);

                    // 6.3 สร้างประวัติ Transaction รายได้ให้ "ผู้แนะนำ" (เปลี่ยน description เป็น title)
                    await client.query(`
                        INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at)
                        VALUES ($1, $2, $3, $4, 'Completed', CURRENT_TIMESTAMP)
                    `, [referrerUserId, commissionAmount, 'COMMISSION_5', `รายได้ 5% จากทีมงาน (${buyer.username})`]);
                }
            }

            await client.query('COMMIT');
            res.json({ success: true, message: "สั่งซื้อสำเร็จ", order_id: newOrderId });

        } catch (innerErr) {
            await client.query('ROLLBACK');
            throw innerErr;
        }

    } catch (err) {
        console.error("Yeeki Buy error:", err);
        res.status(500).json({ 
            success: false, 
            message: `ฐานข้อมูลขัดข้อง (Database Error): ${err.message}` 
        });
    } finally {
        client.release();
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 1. ดึง/อัปเดต การตั้งค่าหวยยี่กีออโต้
// ==========================================
app.get('/api/yeeki/settings', async (req, res) => {
    try {
        const result = await pgPool.query('SELECT is_auto_draw, auto_draw_percent FROM Yeeki_Settings LIMIT 1');
        if (result.rows.length > 0) {
            res.json({ success: true, data: result.rows[0] });
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
        await pgPool.query('UPDATE Yeeki_Settings SET is_auto_draw = $1, auto_draw_percent = $2', [is_auto_draw ? '1' : '0', auto_draw_percent || 50]);
        res.json({ success: true, message: 'บันทึกการตั้งค่าสำเร็จ' });
    } catch (err) {
        console.error("Error saving Yeeki settings:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 1. ดึงประวัติการออกรางวัล (เพื่อให้ตารางหน้าแรกโชว์ผลย้อนหลัง)
// ==========================================
app.get('/api/admin/yeeki-draw-history', async (req, res) => {
    try {
        const { date } = req.query;
        
        // ดึงรอบล่าสุดที่ออกผลแล้วของวันนี้
        const historyReq = await pgPool.query(`
            SELECT * FROM Yeeki_Rounds 
            WHERE CAST(draw_date AS DATE) = CAST($1 AS DATE) AND status = 'Completed' 
            ORDER BY round_number DESC LIMIT 1
        `, [date]);
            
        // ดึงรายชื่อคนถูกรางวัลของวันนี้
        const winnersReq = await pgPool.query(`
            SELECT u.username, o.round_id as round_number, oi.lottery_type, oi.selected_number, oi.price, oi.prize_amount, o.currency_code
            FROM Yeeki_Order_Items oi
            JOIN Yeeki_Orders o ON oi.order_id = o.order_id
            JOIN Users u ON o.user_id = u.user_id
            WHERE CAST(o.created_at AS DATE) = CAST($1 AS DATE) AND oi.status = 'Win'
            ORDER BY o.round_id DESC
        `, [date]);
            
        res.json({ success: true, results: historyReq.rows[0] || null, winners: winnersReq.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API ประกาศผลและตรวจรางวัล (Execute Draw) (มีซ้ำกันกับชุดแรก เอาตามโค้ดต้นฉบับล่าสุดนี้)
// ==========================================
app.post('/api/admin/execute-yeeki-draw', async (req, res) => {
    // 💡 เปลี่ยนมารับค่า top_6
    const { round_id, super_number, top_6 } = req.body;
    const client = await pgPool.connect(); // ใช้ Transaction
    
    try {
        await client.query('BEGIN');

        try {
            // 💡 แตกเลข
            const top_4 = top_6.slice(-4);
            const top_3 = top_6.slice(-3);
            const top_2 = top_6.slice(-2);
            const bottom_2 = top_6.slice(2, 4);

            // 1. อัปเดตผลรางวัลลงตาราง
            await client.query(`
                UPDATE Yeeki_Rounds 
                SET result_8_super = $1, 
                    result_4_top = $2, 
                    result_3_top = $3, 
                    result_2_bottom = $4,
                    status = 'Completed' 
                WHERE round_id = $5
            `, [super_number, top_4, top_3, bottom_2, round_id]);

            const ratesReq = await client.query(`SELECT lottery_type, multiplier FROM Yeeki_Prize_Rates`);
            const prizeRates = {};
            ratesReq.rows.forEach(r => prizeRates[r.lottery_type] = parseFloat(r.multiplier));

            const itemsReq = await client.query(`
                SELECT i.item_id, i.order_id, i.lottery_type, i.selected_number, i.price, o.user_id, o.currency_code
                FROM Yeeki_Order_Items i
                JOIN Yeeki_Orders o ON i.order_id = o.order_id
                WHERE o.round_id = $1 AND i.status = 'รอผลตรวจ'
            `, [round_id]);

            const items = itemsReq.rows;

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
                    const prizeAmount = parseFloat(item.price) * (prizeRates[type] || 0);

                    await client.query(`UPDATE Yeeki_Order_Items SET status = 'ชนะ', prize_amount = $1 WHERE item_id = $2`, [prizeAmount, item.item_id]);

                    await client.query(`UPDATE Users SET wallet_balance = COALESCE(wallet_balance, 0) + $1 WHERE user_id = $2`, [prizeAmount, item.user_id]);

                    await client.query(`
                        INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at)
                        VALUES ($1, $2, 'PRIZE_WIN', $3, 'Completed', CURRENT_TIMESTAMP)
                    `, [item.user_id, prizeAmount, `ถูกรางวัล ${type} (${num}) รอบที่ ${round_id}`]);
                } else {
                    await client.query(`UPDATE Yeeki_Order_Items SET status = 'แพ้' WHERE item_id = $1`, [item.item_id]);
                }
            }

            await client.query('COMMIT');
            res.json({ success: true, message: "ประกาศผลและโอนเงินรางวัลเสร็จสิ้น!" });

        } catch (innerErr) {
            await client.query('ROLLBACK');
            throw innerErr;
        }

    } catch (err) {
        console.error("Execute Draw error:", err);
        res.status(500).json({ success: false, message: `Database Error: ${err.message}` });
    } finally {
        client.release();
    }
});
// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API ค้นหาประวัติการซื้อ (ล็อคเป้า "เฉพาะรอบที่เลือกเท่านั้น" + แม่นยำ 100%)
// ==========================================
app.post('/api/admin/search-yeeki-buyers', async (req, res) => {
    // 🔴 รับค่า round_id มาจากหน้าเว็บ แทนที่จะเป็น date
    const { number, round_id } = req.body;

    if (!number || !round_id) {
        return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน (ขาดเลขหรือรหัสรอบ)' });
    }

    try {
        const ratesReq = await pgPool.query(`SELECT lottery_type, multiplier FROM Yeeki_Prize_Rates`);
        const prizeRates = {};
        ratesReq.rows.forEach(r => prizeRates[r.lottery_type] = parseFloat(r.multiplier));

        const exReq = await pgPool.query(`SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'`);
        const lakRate = exReq.rows[0]?.rate ? parseFloat(exReq.rows[0].rate) : 620;

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
            WHERE r.round_id = $1 
              AND i.selected_number = $2
            ORDER BY r.round_number ASC
        `;

        const result = await pgPool.query(query, [round_id, number.trim()]);

        const buyers = result.rows.map(w => {
            const multiplier = prizeRates[w.lottery_type] || 0;
            const priceVal = parseFloat(w.price);
            const prize = priceVal * multiplier;
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

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 4. API จำลองการตั้งค่า (Settings & Prize Rates เพื่อป้องกันหน้าเว็บ Error ตอนโหลด)
// ==========================================
app.get('/api/yeeki/settings', (req, res) => {
    // ปัจจุบันส่งค่า Default ไปก่อน ถ้ามีตารางตั้งค่าในอนาคตค่อยมาแก้ตรงนี้ครับ
    res.json({ success: true, data: { is_auto_draw: true, auto_draw_percent: 25 } });
});
app.post('/api/yeeki/settings', (req, res) => res.json({ success: true }));

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API ดึงอัตราจ่าย (GET) - ดึงจาก Database จริง
// ==========================================
app.get('/api/yeeki/prize-rates', async (req, res) => {
    try {
        const result = await pgPool.query(`
            SELECT lottery_type, multiplier 
            FROM Yeeki_Prize_Rates
        `);
        res.json({ success: true, rates: result.rows });
    } catch (err) {
        console.error('Error fetching prize rates:', err);
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API บันทึกอัตราจ่าย (POST) - เวอร์ชันครอบจักรวาล รองรับทั้ง Array และ Object
// ==========================================
app.post('/api/yeeki/prize-rates', async (req, res) => {
    const client = await pgPool.connect(); // ใช้ Transaction เผื่อ Update หลายแถว
    try {
        const { rates } = req.body; 
        
        if (!rates) {
            return res.status(400).json({ success: false, message: 'ไม่มีข้อมูลอัตราจ่ายส่งมา' });
        }

        let totalUpdated = 0;
        await client.query('BEGIN');

        // 🟢 ตรวจสอบว่าหน้าเว็บส่งมาเป็น Array (แบบตาราง) ใช่หรือไม่
        if (Array.isArray(rates)) {
            for (const item of rates) {
                const type = item.lottery_type;
                const numericMultiplier = Number(item.multiplier);

                if (type && !isNaN(numericMultiplier)) {
                    const result = await client.query(`
                        UPDATE Yeeki_Prize_Rates 
                        SET multiplier = $1, updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC' 
                        WHERE lottery_type = $2
                    `, [numericMultiplier, type.trim()]);
                    totalUpdated += result.rowCount || 0;
                }
            }
        } 
        // 🟢 หรือหน้าเว็บส่งมาเป็น Object (แบบจับคู่)
        else {
            for (const [type, multiplier] of Object.entries(rates)) {
                const numericMultiplier = Number(multiplier);

                if (!isNaN(numericMultiplier)) {
                    const result = await client.query(`
                        UPDATE Yeeki_Prize_Rates 
                        SET multiplier = $1, updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC' 
                        WHERE lottery_type = $2
                    `, [numericMultiplier, type.trim()]);
                    totalUpdated += result.rowCount || 0;
                }
            }
        }
        
        await client.query('COMMIT');
        console.log(`✅ อัปเดตอัตราจ่ายลง Database สำเร็จทั้งหมด: ${totalUpdated} แถว`);
        res.json({ success: true, message: 'บันทึกอัตราจ่ายสำเร็จ' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error updating prize rates:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        client.release();
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// ==========================================
app.get('/api/admin/exchange-rates', (req, res) => {
    res.json({ success: true, rates: [{ currency_pair: 'THB_LAK', rate: 620 }] });
});
app.post('/api/admin/exchange-rates', (req, res) => res.json({ success: true }));


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API ประกาศผลและตรวจรางวัลยี่กี (Execute Draw) - ยึดตามเวอร์ชันล่าสุดที่คุณวิทยาส่งมา
// ==========================================
app.post('/api/admin/execute-yeeki-draw', async (req, res) => {
    const { round_id, super_number, top_number, bottom_number } = req.body;
    const client = await pgPool.connect(); // ใช้ Transaction

    try {
        await client.query('BEGIN');

        try {
            // 1. อัปเดตผลรางวัลลงตาราง Yeeki_Rounds
            const result3Top = top_number.slice(-3);
            const result2Top = top_number.slice(-2);

            await client.query(`
                UPDATE Yeeki_Rounds 
                SET result_8_super = $1, 
                    result_4_top = $2, 
                    result_3_top = $3, 
                    result_2_bottom = $4,
                    status = 'Completed' 
                WHERE round_id = $5
            `, [super_number, top_number, result3Top, bottom_number, round_id]);

            // 2. ดึงอัตราการจ่าย (Multiplier) ทั้งหมด
            const ratesReq = await client.query(`SELECT lottery_type, multiplier FROM Yeeki_Prize_Rates`);
            const prizeRates = {};
            ratesReq.rows.forEach(r => prizeRates[r.lottery_type] = parseFloat(r.multiplier));

            // 3. ดึงรายการบิลที่รอตรวจของรอบนี้
            const itemsReq = await client.query(`
                SELECT i.item_id, i.order_id, i.lottery_type, i.selected_number, i.price, o.user_id, o.currency_code
                FROM Yeeki_Order_Items i
                JOIN Yeeki_Orders o ON i.order_id = o.order_id
                WHERE o.round_id = $1 AND i.status = 'รอผลตรวจ'
            `, [round_id]);

            const items = itemsReq.rows;

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
                    const prizeAmount = parseFloat(item.price) * multiplier;

                    // 4.1 อัปเดตสถานะบิลย่อยเป็น "ชนะ"
                    await client.query(`UPDATE Yeeki_Order_Items SET status = 'ชนะ', prize_amount = $1 WHERE item_id = $2`, [prizeAmount, item.item_id]);

                    // 4.2 โอนเงินเข้า Wallet ผู้ชนะ (ไม่อัปเดต Wallets เพราะคุณวิทยาให้ยึด Logic เดิมที่อัปเดตแค่ Users)
                    await client.query(`UPDATE Users SET wallet_balance = COALESCE(wallet_balance, 0) + $1 WHERE user_id = $2`, [prizeAmount, item.user_id]);

                    // 4.3 สร้างประวัติเงินเข้า (Transactions) -> แก้ใช้คอลัมน์ title แล้ว
                    await client.query(`
                        INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at)
                        VALUES ($1, $2, 'PRIZE_WIN', $3, 'Completed', CURRENT_TIMESTAMP)
                    `, [item.user_id, prizeAmount, `ถูกรางวัล ${type} (${num}) รอบที่ ${round_id}`]);
                } else {
                    // 4.4 ถ้าไม่ถูกรางวัล อัปเดตเป็น "แพ้"
                    await client.query(`UPDATE Yeeki_Order_Items SET status = 'แพ้' WHERE item_id = $1`, [item.item_id]);
                }
            }

            await client.query('COMMIT');
            res.json({ success: true, message: "ประกาศผลและโอนเงินรางวัลเสร็จสิ้น!" });

        } catch (innerErr) {
            await client.query('ROLLBACK');
            throw innerErr;
        }

    } catch (err) {
        console.error("Execute Draw error:", err);
        res.status(500).json({ success: false, message: `Database Error: ${err.message}` });
    } finally {
        client.release();
    }
});
// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 2. ดึงข้อมูล 24 รอบของวันนี้ (ทั้งหน้าบ้านและหลังบ้านใช้ร่วมกัน)
// ==========================================
app.get('/api/yeeki/rounds', async (req, res) => {
    try {
        // 🌟 ดึงข้อมูลรอบของวันนี้ (อิงเวลาไทย) และ กรองเฉพาะหวยยี่กี (category = 'YEEKI' หรือ NULL) ห้ามดึงหวยไทยมา
        const result = await pgPool.query(`
            SELECT 
                round_id, 
                round_number,
                to_char(open_time, 'YYYY-MM-DD HH24:MI:SS') as open_time,
                to_char(close_time, 'YYYY-MM-DD HH24:MI:SS') as close_time,
                to_char(draw_time, 'YYYY-MM-DD HH24:MI:SS') as draw_time,
                status
            FROM Yeeki_Rounds 
            WHERE CAST(draw_date AS DATE) = CAST(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok' AS DATE) 
            AND (category = 'YEEKI' OR category IS NULL)
            ORDER BY round_number ASC
        `);
        
        res.json({ success: true, rounds: result.rows });
    } catch (err) {
        console.error("Error fetching Yeeki rounds:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});                                                                                             

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API ฝั่งหลังบ้าน (Admin) ดึงข้อมูลรอบตาม "วันที่เลือก" บนปฏิทิน
// ==========================================
app.get('/api/admin/yeeki-rounds', async (req, res) => {
    try {
        const { date } = req.query; // รับค่า YYYY-MM-DD จากปฏิทิน
        const result = await pgPool.query(`
            SELECT 
                round_id, 
                round_number,
                to_char(open_time, 'YYYY-MM-DD HH24:MI:SS') as open_time,
                to_char(close_time, 'YYYY-MM-DD HH24:MI:SS') as close_time,
                to_char(draw_time, 'YYYY-MM-DD HH24:MI:SS') as draw_time,
                status
            FROM Yeeki_Rounds 
            WHERE CAST(draw_date AS DATE) = CAST($1 AS DATE) 
            AND (category = 'YEEKI' OR category IS NULL)
            ORDER BY round_number ASC
        `, [date]);
        
        res.json({ success: true, rounds: result.rows });
    } catch (err) {
        console.error("Error admin fetch rounds:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 3. อัปเดตตารางรอบ 24 รอบรวดเดียว (POST Bulk)
// ==========================================
app.post('/api/admin/yeeki-rounds/bulk', async (req, res) => {
    try {
        const { date, rounds } = req.body;
        
        for (const round of rounds) {
            const openTime = `${date} ${round.open_time}:00`;
            const closeTime = `${date} ${round.close_time}:00`;
            const drawTime = `${date} ${round.draw_time}:00`;

            const check = await pgPool.query(`
                SELECT round_id FROM Yeeki_Rounds 
                WHERE CAST(draw_date AS DATE) = CAST($1 AS DATE) 
                AND round_number = $2 
                AND (category = 'YEEKI' OR category IS NULL)
            `, [date, round.round_number]);
            
            if (check.rows.length > 0) {
                // มีแล้ว -> Update
                await pgPool.query(`
                    UPDATE Yeeki_Rounds 
                    SET open_time = CAST($1 AS TIMESTAMP), close_time = CAST($2 AS TIMESTAMP), draw_time = CAST($3 AS TIMESTAMP) 
                    WHERE round_id = $4
                `, [openTime, closeTime, drawTime, check.rows[0].round_id]);
            } else {
                // ยังไม่มี -> Insert (ตั้งค่าบังคับให้เป็น YEEKI ไปเลย)
                await pgPool.query(`
                    INSERT INTO Yeeki_Rounds (draw_date, round_number, open_time, close_time, draw_time, status, category) 
                    VALUES (CAST($1 AS DATE), $2, CAST($3 AS TIMESTAMP), CAST($4 AS TIMESTAMP), CAST($5 AS TIMESTAMP), $6, $7)
                `, [date, round.round_number, openTime, closeTime, drawTime, 'Pending', 'YEEKI']);
            }
        }
        res.json({ success: true, message: "บันทึกข้อมูลตารางเวลาสำเร็จ!" });
    } catch (err) {
        console.error("Error bulk save:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 4. อัปเดตทีละแถว จากการกดปุ่มแก้ไข (PUT)
// ==========================================
app.put('/api/admin/yeeki-rounds/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { draw_date, open_time, close_time, draw_time } = req.body;
        
        const openTime = `${draw_date} ${open_time}:00`;
        const closeTime = `${draw_date} ${close_time}:00`;
        const drawTime = `${draw_date} ${draw_time}:00`;

        await pgPool.query(`
            UPDATE Yeeki_Rounds 
            SET open_time = CAST($1 AS TIMESTAMP), close_time = CAST($2 AS TIMESTAMP), draw_time = CAST($3 AS TIMESTAMP) 
            WHERE round_id = $4
        `, [openTime, closeTime, drawTime, id]);
            
        res.json({ success: true });
    } catch (err) {
        console.error("Error update single round:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 3. หัวใจอัจฉริยะ: ระบบแนะนำเลขเด็ด (ให้ระบบได้กำไรตามเป้า)
// ==========================================
app.post('/api/admin/suggest-yeeki-draw', async (req, res) => {
    try {
        const { targetPercent, round_id } = req.body;

        // 1. ดึงยอดซื้อทั้งหมดในรอบนี้
        const ordersRes = await pgPool.query(`
            SELECT oi.lottery_type, oi.selected_number, oi.price, pr.multiplier
            FROM Yeeki_Order_Items oi
            JOIN Yeeki_Orders o ON oi.order_id = o.order_id
            JOIN Yeeki_Prize_Rates pr ON CAST(oi.lottery_type AS VARCHAR) = CAST(pr.lottery_type AS VARCHAR)
            WHERE o.round_id = $1 AND oi.status = 'รอผลตรวจ'
        `, [round_id]);
        
        const orders = ordersRes.rows;

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
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 2. API: จำลองผลตรวจรางวัล (Analyze Draw)
// ==========================================
app.post('/api/admin/analyze-yeeki-draw', async (req, res) => {
    const { round_id, super_number, top_6, bottom_2 } = req.body; 
    try {
        const exReq = await pgPool.query("SELECT rate FROM ExchangeRates WHERE currency_pair = 'THB_LAK'");
        const lakRate = exReq.rows.length > 0 ? parseFloat(exReq.rows[0].rate) : 620;

        const top_4 = top_6.slice(-4);
        const top_3 = top_6.slice(-3);
        const top_2 = top_6.slice(-2);

        const itemsReq = await pgPool.query(`
            SELECT i.lottery_type, i.selected_number, i.price, o.currency_code
            FROM Yeeki_Order_Items i
            JOIN Yeeki_Orders o ON i.order_id = o.order_id
            WHERE o.round_id = $1 AND i.status = 'รอผลตรวจ'
        `, [round_id]);
        const orders = itemsReq.rows;

        const ratesReq = await pgPool.query(`SELECT lottery_type, multiplier FROM Yeeki_Prize_Rates`);
        const prizeRates = {};
        ratesReq.rows.forEach(r => prizeRates[r.lottery_type] = parseFloat(r.multiplier));

        const analysis = {};
        ['8 ตัว (Super)', '6 ตัว', '4 ตัวท้าย', '3 ตัวบน', '3 ตัวโต๊ด', '2 ตัวบน', '2 ตัวล่าง', 'วิ่งบน', 'วิ่งล่าง'].forEach(t => 
            analysis[t] = { lottery_type: t, winner_count: 0, total_payout_thb: 0 }
        );

        let totalSalesTHB = 0;

        for (let order of orders) {
            let isWin = false;
            const num = order.selected_number;
            const orderPrice = parseFloat(order.price);
            
            totalSalesTHB += order.currency_code === 'LAK' ? (orderPrice / lakRate) : orderPrice;

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
                const payout = orderPrice * (prizeRates[order.lottery_type] || 0);
                const payoutTHB = order.currency_code === 'LAK' ? (payout / lakRate) : payout;
                analysis[order.lottery_type].winner_count += 1;
                analysis[order.lottery_type].total_payout_thb += payoutTHB;
            }
        }
        res.json({ success: true, totalSalesTHB, analysis: Object.values(analysis) });
    } catch (err) { 
        console.error("Analyze draw error:", err);
        res.status(500).json({ success: false, message: err.message }); 
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API ดึงผลรางวัล ยอดขาย และบิลทั้งหมดเจาะจงตามรอบ
// ==========================================
app.get('/api/admin/yeeki-round-detail', async (req, res) => {
    const { round_id } = req.query;
    try {
        // 1. ดึงผลการออกรางวัลของรอบนี้
        const roundReq = await pgPool.query(`SELECT * FROM Yeeki_Rounds WHERE round_id = $1`, [round_id]);
            
        // 2. 💡 ดึง "บิลทั้งหมด" ของรอบนี้ (ไม่ต้องสนสถานะ เพื่อให้หน้าเว็บไปตรวจเอง)
        const allOrdersReq = await pgPool.query(`
            SELECT 
                r.round_number, u.username, i.lottery_type, i.selected_number, 
                i.price, o.currency_code, i.status, i.prize_amount
            FROM Yeeki_Order_Items i
            JOIN Yeeki_Orders o ON i.order_id = o.order_id
            JOIN Yeeki_Rounds r ON o.round_id = r.round_id
            JOIN Users u ON o.user_id = u.user_id
            WHERE r.round_id = $1
        `, [round_id]);

        // 3. ดึงยอดขายรวม
        const salesReq = await pgPool.query(`
            SELECT o.currency_code, SUM(i.price) as total_sales
            FROM Yeeki_Order_Items i
            JOIN Yeeki_Orders o ON i.order_id = o.order_id
            WHERE o.round_id = $1
            GROUP BY o.currency_code
        `, [round_id]);

        res.json({
            success: true,
            round: roundReq.rows[0],
            all_orders: allOrdersReq.rows, // 💡 ส่งบิลทั้งหมดไปให้หน้าเว็บ
            sales: salesReq.rows
        });
    } catch (err) {
        console.error("Error in yeeki-round-detail:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🏦 API: จัดการบัญชีธนาคารรับฝากเงิน (Receiving Accounts)
// ==========================================

// 1. API: ดึงข้อมูลธนาคารทั้งหมด (GET)
app.get('/api/admin/banks', async (req, res) => {
    try {
        // ดึงข้อมูลเรียงตาม bank_id
        const result = await pgPool.query(`
            SELECT * FROM Banks 
            ORDER BY bank_id ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching banks:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 2. API: เพิ่มบัญชีธนาคารใหม่ (POST)
app.post('/api/admin/banks', async (req, res) => {
    const { bank_name, bank_code, account_name, account_number, currency, logo_url, is_active } = req.body;
    try {
        await pgPool.query(`
            INSERT INTO Banks (bank_name, bank_code, account_name, account_number, currency, logo_url, is_active, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        `, [
            bank_name, 
            bank_code, 
            account_name, 
            account_number, 
            currency, 
            logo_url || '', 
            is_active ? '1' : '0'
        ]);
            
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
        await pgPool.query(`
            UPDATE Banks 
            SET bank_name = $1, 
                bank_code = $2, 
                account_name = $3, 
                account_number = $4, 
                currency = $5, 
                logo_url = $6, 
                is_active = $7
            WHERE bank_id = $8
        `, [
            bank_name, 
            bank_code, 
            account_name, 
            account_number, 
            currency, 
            logo_url || '', 
            is_active ? '1' : '0', 
            id
        ]);
            
        res.json({ success: true, message: 'อัปเดตบัญชีธนาคารสำเร็จ' });
    } catch (err) {
        console.error("Error updating bank:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});
// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🏆 API: ดึงประวัติการออกเลขยี่กีตามวันที่
// ==========================================
app.get('/api/admin/yeeki/history', async (req, res) => {
    const { date } = req.query; // รับค่าวันที่ YYYY-MM-DD
    try {
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

        let queryParams = [];

        if (date) {
            query += ` AND CAST(draw_time AS DATE) = CAST($1 AS DATE) `;
            queryParams.push(date);
        }
        
        query += ` ORDER BY round_number DESC`;

        const result = await pgPool.query(query, queryParams);
        res.json({ success: true, data: result.rows });

    } catch (err) {
        console.error("Error fetching yeeki history:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 เริ่ม API P2P
// ==========================================


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 💸 [CLIENT] สร้างคำขอฝากเงิน (อัปเกรด: ค้นหาโปรโมชั่น 20% ให้อัตโนมัติ!)
// ==========================================
app.post('/api/p2p/request-deposit', async (req, res) => {
    try {
        const { requester_id, amount, currency } = req.body; 
        if (!requester_id || !amount) return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });

        let bonus_amount = 0;
        let provider_reward = 0; 
        let board_timeout = 15;
        let bonusPercent = 0;
        
        // 🌟 1. ดึงการตั้งค่าหลักจากหน้าแอดมิน (P2P_Settings)
        const settings = await pgPool.query('SELECT * FROM P2P_Settings LIMIT 1');
        let config = {};
        if (settings.rows.length > 0) {
            config = settings.rows[0];
            
            // ดึงค่าคอมมิชชั่นคนรับงาน (เช่น 15%)
            provider_reward = (parseFloat(amount) * parseFloat(config.provider_reward_percent || 15)) / 100;
            
            // ดึงเวลาหมดอายุ (เช่น 15 นาที)
            board_timeout = config.mission_timeout_minutes || 15;
        } else {
            provider_reward = (parseFloat(amount) * 15) / 100; // ค่าสำรองเผื่อตารางพัง
        }

       // 🌟 2. ค้นหาโปรโมชั่น "ที่กำลังทำงานอยู่" (เช็คจากเวลาปัจจุบัน)
        const promoCheck = await pgPool.query(`
            SELECT bonus_percent 
            FROM P2P_Promotions 
            WHERE CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok' BETWEEN start_time AND end_time 
            ORDER BY bonus_percent DESC
            LIMIT 1
        `);

        if (promoCheck.rows.length > 0) {
            // ✅ ถ้าช่วงนี้มีโปรโมชั่น (เช่น 20%) ให้ใช้ค่านี้บวกเพิ่มให้ลูกค้า!
            bonusPercent = parseFloat(promoCheck.rows[0].bonus_percent);
        } else {
            // ✅ ถ้าหมดโปร หรือไม่มีโปรโมชั่น = ไม่ต้องบวกเพิ่ม (โบนัส 0%) คือยอดปกติ
            bonusPercent = 0;
        }

        // คำนวณเงินโบนัส และยอดรับสุทธิ
        bonus_amount = (parseFloat(amount) * bonusPercent) / 100;
        const net_amount = parseFloat(amount) + bonus_amount;

        // 🌟 3. บันทึกลงตาราง (รองรับการบวกเวลา Interval นาที)
        await pgPool.query(`
            INSERT INTO P2P_Requests (requester_id, request_type, currency, amount, bonus_or_fee, net_amount, provider_reward, status, created_at, expires_at) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok') + ($8 || ' minutes')::interval)
        `, [requester_id, 'DEPOSIT', currency || 'THB', amount, bonus_amount, net_amount, provider_reward, board_timeout]);

        res.json({ success: true, message: 'สร้างคำขอฝากเงินสำเร็จ' });
    } catch (err) {
        console.error("Deposit Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// ⏱️ [ADMIN] ดึงข้อมูลตั้งค่าเวลา P2P (แพ็คคู่)
// ==========================================
app.get('/api/admin/p2p-time-setting', async (req, res) => {
    try {
        const result = await pgPool.query('SELECT * FROM P2P_Settings LIMIT 1');
        if (result.rows.length > 0) {
            res.json({ 
                success: true, 
                board_timeout: result.rows[0].mission_timeout_minutes || 30,
                provider_timeout: result.rows[0].provider_timeout_minutes || 15 
            });
        } else {
            res.json({ success: true, board_timeout: 30, provider_timeout: 15 });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// ⏱️ [ADMIN] อัปเดตเวลาภารกิจ P2P (แพ็คคู่)
// ==========================================
app.post('/api/admin/p2p-time-update', async (req, res) => {
    try {
        const { board_timeout, provider_timeout } = req.body;
        const check = await pgPool.query('SELECT CAST(COUNT(*) AS INTEGER) as count FROM P2P_Settings');
        
        try {
            if (check.rows[0].count === 0) {
                await pgPool.query(`INSERT INTO P2P_Settings (mission_timeout_minutes, provider_timeout_minutes) VALUES ($1, $2)`, [board_timeout, provider_timeout]);
            } else {
                await pgPool.query(`UPDATE P2P_Settings SET mission_timeout_minutes = $1, provider_timeout_minutes = $2`, [board_timeout, provider_timeout]);
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
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🚀 [PROVIDER] ผู้รับงานกด "รับงาน" (ACCEPT JOB) - อัปเกรดกันเงินติดลบ & แก้บั๊กประเทศ & แปลงสกุลเงินก่อนหัก
// ==========================================
app.post('/api/p2p/accept-job', async (req, res) => {
    try {
        const { provider_id, request_id } = req.body;
        const client = await pgPool.connect(); // ใช้ Transaction
        
        try {
            await client.query('BEGIN');

            // 1. ดึงข้อมูลงาน
            const jobCheck = await client.query(`
                SELECT r.*, u.country AS req_country, u.currency_code AS req_currency 
                FROM P2P_Requests r
                INNER JOIN users u ON r.requester_id = u.user_id
                WHERE r.request_id = $1 AND r.status = 'PENDING'
            `, [request_id]);
            
            if (jobCheck.rows.length === 0) {
                throw new Error('งานนี้ถูกรับไปแล้ว หรือหมดเวลาแล้วครับ');
            }
            const job = jobCheck.rows[0];

            if (job.requester_id === parseInt(provider_id)) {
                throw new Error('ไม่สามารถรับงานของตัวเองได้ครับ');
            }

            // 2. ดึงข้อมูล "บัญชีธนาคารของผู้รับงาน" (เช็คให้ตรงกับสกุลเงินของงาน) และสกุลเงินของ Wallet
            const provBankCheck = await client.query(`
                SELECT ub.account_number, bk.bank_name, u.currency_code AS provider_wallet_currency
                FROM UserBanks ub
                INNER JOIN Banks bk ON ub.bank_id = bk.bank_id
                INNER JOIN users u ON ub.user_id = u.user_id
                WHERE ub.user_id = $1 
                AND ub.currency_code = $2  
                AND (ub.status = 'Approved' OR ub.status = 'APPROVED')
                LIMIT 1
            `, [provider_id, job.req_currency]);
            
            // ถ้าหาบัญชีธนาคารไม่เจอ
            if (provBankCheck.rows.length === 0) {
                throw new Error(`ไม่สามารถรับงานได้! งานนี้สำหรับบัญชีสกุลเงิน ${job.req_currency} เท่านั้น (คุณต้องผูกและรออนุมัติบัญชีก่อน)`);
            }

            const providerWalletCurrency = provBankCheck.rows[0].provider_wallet_currency;

            // 3. แยก Logics ตามประเภทงาน (DEPOSIT / WITHDRAW)
            if (job.request_type === 'DEPOSIT') {
                // 🌟 คำนวณยอดเงินที่ต้องหัก (โดยแปลงให้เป็นสกุลเงินของ Wallet ผู้รับงานก่อน)
                let requireAmountInProviderCurrency = parseFloat(job.amount);

                if (providerWalletCurrency !== job.currency) {
                     const rateCheck = await client.query(`
                        SELECT currency_pair, rate FROM ExchangeRates WHERE currency_pair = $1 OR currency_pair = $2
                     `, [`${job.currency}_${providerWalletCurrency}`, `${providerWalletCurrency}_${job.currency}`]);
                    
                    if (rateCheck.rows.length > 0) {
                        const exRate = rateCheck.rows[0];
                        if (exRate.currency_pair === `${job.currency}_${providerWalletCurrency}`) {
                            requireAmountInProviderCurrency = requireAmountInProviderCurrency * parseFloat(exRate.rate);
                        } else {
                            requireAmountInProviderCurrency = requireAmountInProviderCurrency / parseFloat(exRate.rate);
                        }
                    } else {
                         throw new Error(`ระบบไม่พบอัตราแลกเปลี่ยนระหว่าง ${job.currency} และ ${providerWalletCurrency} กรุณาติดต่อ Admin`);
                    }
                }

                // เช็คเงินค้ำประกัน (เทียบกับยอดที่แปลงแล้ว)
                const provWalletCheck = await client.query('SELECT balance FROM Wallets WHERE user_id = $1', [provider_id]);
                const provBalance = parseFloat(provWalletCheck.rows[0].balance || 0);

                if (provBalance < requireAmountInProviderCurrency) {
                    throw new Error(`ยอดเงินค้ำประกันไม่พอ (คุณต้องมีอย่างน้อย ${requireAmountInProviderCurrency.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${providerWalletCurrency})`);
                }

                // หักเงินค้ำประกัน (หักเป็นยอดที่แปลงแล้ว)
                const escrowUpdate = await client.query(`
                    UPDATE Wallets SET balance = balance - $1 WHERE user_id = $2 AND balance >= $1
                `, [requireAmountInProviderCurrency, provider_id]);

                if (escrowUpdate.rowCount === 0) {
                    throw new Error('ยอดเงินค้ำประกันไม่เพียงพอ หรือมีการทำรายการซ้อนทับกันครับ');
                }

                // บันทึก Transaction (ประกอบ String Message จาก Node.js ป้องกัน Syntax SQL)
                const jobAmountFormatted = parseFloat(job.amount).toFixed(2);
                const titleText = `หักเงินค้ำประกัน รอโอน P2P (Job ID: ${request_id}) [${jobAmountFormatted} ${job.currency}]`;

                await client.query(`
                    INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                    VALUES ($1, $2, 'P2P_Escrow', $3, 'Completed', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')
                `, [provider_id, -requireAmountInProviderCurrency, titleText]);
            } 

            // 4. เปลี่ยนสถานะงานเป็น ACCEPTED 
            await client.query(`
                UPDATE P2P_Requests 
                SET status = 'ACCEPTED', 
                    provider_id = $1, 
                    accepted_at = CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok' 
                WHERE request_id = $2
            `, [provider_id, request_id]);

            await client.query('COMMIT');
            res.json({ success: true, message: '✅ รับงานสำเร็จ! กรุณาตรวจสอบและดำเนินการตามเวลาที่กำหนด' });

        } catch (innerErr) {
            await client.query('ROLLBACK'); 
            throw innerErr;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("Accept Job Error:", err);
        res.status(400).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🚫 [API] ยกเลิกงาน P2P (คืนเงินค้ำประกัน + บันทึกประวัติ)
// ==========================================
app.post('/api/p2p/cancel-job', async (req, res) => {
    try {
        const { provider_id, request_id } = req.body;

        // 1. เช็คข้อมูลงาน
        const reqResult = await pgPool.query(`SELECT * FROM P2P_Requests WHERE request_id = $1`, [request_id]);
            
        if (reqResult.rows.length === 0) return res.json({ success: false, message: 'ไม่พบงานนี้ในระบบ' });
        const mission = reqResult.rows[0];

        // ต้องเป็นสถานะ ACCEPTED และต้องเป็นคนที่รับงานนี้จริงๆ เท่านั้นถึงจะยกเลิกได้
        if (mission.status !== 'ACCEPTED' || mission.provider_id !== parseInt(provider_id)) {
            return res.json({ success: false, message: 'ไม่สามารถยกเลิกได้ สถานะไม่ถูกต้อง หรือคุณไม่ใช่ผู้รับงานนี้' });
        }

        // 2. คำนวณยอดเงินที่ต้องคืน (ใช้โลจิกเดียวกับตอนหักเงิน)
        // 🛠️ กำหนดกระเป๋าหลักเป็น THB 
        const providerCurrency = 'THB'; 
        let refundAmount = parseFloat(mission.amount);

        // คำนวณเรทเงินให้ตรงกับตอนที่หักไป
        if (providerCurrency !== mission.currency) {
            const rateResult = await pgPool.query('SELECT * FROM ExchangeRates');
            const rates = rateResult.rows;
            const rateObj = rates.find(r => r.currency_pair === `${providerCurrency}_${mission.currency}`);
            const reverseRateObj = rates.find(r => r.currency_pair === `${mission.currency}_${providerCurrency}`);
            
            if (rateObj) refundAmount = refundAmount / parseFloat(rateObj.rate);
            else if (reverseRateObj) refundAmount = refundAmount * parseFloat(reverseRateObj.rate);
            else return res.json({ success: false, message: `ไม่มีเรทแปลงเงิน ${providerCurrency} เป็น ${mission.currency}` });
        }

        // 3. คืนเงินกลับเข้า Wallet (บวกเงินกลับ)
        await pgPool.query(`UPDATE Wallets SET balance = balance + $1 WHERE user_id = $2`, [refundAmount, provider_id]);

        // 4. 📝 บันทึกประวัติการคืนเงินลงตาราง Transactions (ทิ้งหลักฐาน)
        await pgPool.query(`
                INSERT INTO Transactions (user_id, amount, transaction_type, status, title, created_at)
                VALUES ($1, $2, 'P2P_REFUND', 'Completed', $3, CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')
            `, [provider_id, refundAmount, `โอนกลับเป็นเงินโอนกลับจากการยกเลิกงาน P2P (Job ID: ${request_id})`]
        );

        // 5. ปล่อยงานกลับสู่บอร์ด (รีเซ็ตสถานะกลับเป็น PENDING และล้างค่าเวลาออก)
        await pgPool.query(`
                UPDATE P2P_Requests 
                SET status = 'PENDING', 
                    provider_id = NULL, 
                    accepted_at = NULL, 
                    expires_at = NULL 
                WHERE request_id = $1
            `, [request_id]
        );

        res.json({ success: true, message: 'ยกเลิกงานและคืนเงินค้ำประกันเรียบร้อยแล้ว!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// ✅ [API] ตรวจสอบสลิปและจบงาน P2P
// ==========================================
app.post('/api/p2p/verify-slip', async (req, res) => {
    try {
        const { provider_id, request_id, is_correct } = req.body;

        const reqData = await pgPool.query(`SELECT * FROM P2P_Requests WHERE request_id = $1 AND provider_id = $2`, [request_id, provider_id]);
        
        if (reqData.rows.length === 0) {
            return res.status(400).json({ success: false, message: '❌ ไม่พบข้อมูลงาน หรือคุณไม่ใช่ผู้รับงานนี้' });
        }

        const job = reqData.rows[0];
        const jobCurrency = job.currency;

        if (job.status !== 'VERIFYING' && job.status !== 'ACCEPTED') {
            return res.status(400).json({ success: false, message: '⚠️ งานนี้ถูกดำเนินการเสร็จสิ้น หรือถูกยกเลิกไปแล้วครับ' });
        }

        const client = await pgPool.connect();
        await client.query('BEGIN');

        try {
            // 🌟 1. ค้นหายอดค้ำประกัน "ของจริง" ที่โดนหักไป (เผื่อไว้ใช้ตอนสลิปปลอม จะได้คืนให้)
            const escrowCheck = await client.query(`
                SELECT ABS(amount) as deducted_amount 
                FROM Transactions 
                WHERE user_id = $1 
                  AND title LIKE $2 
                  AND amount < 0
                ORDER BY transaction_id DESC
                LIMIT 1
            `, [provider_id, `%Job ID: ${request_id}%`]);
            
            const actualEscrow = escrowCheck.rows.length > 0 ? parseFloat(escrowCheck.rows[0].deducted_amount) : parseFloat(job.amount);

            if (is_correct) {
                // ✅ 1. เติมเงินให้คนฝาก (เอาเงินค้ำประกันไปให้คนฝาก)
                await client.query(`UPDATE Wallets SET balance = balance + $1 WHERE user_id = $2`, [job.net_amount, job.requester_id]);
                
                await client.query(`
                    INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                    VALUES ($1, $2, 'Deposit', $3, 'Completed', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')
                `, [job.requester_id, job.net_amount, `รับเงินฝากผ่านระบบ P2P (งาน ID: ${request_id})`]);

                // ✅ 2. จ่ายเฉพาะ "ค่าคอมมิชชั่น" ให้คนรับงาน (🚨 ไม่คืนเงินต้น เพราะรับเงินเข้าบัญชีธนาคารไปแล้ว)
                let rewardAmount = parseFloat(job.provider_reward); // ค่าคอมตั้งต้น
                
                // ดึงสกุลเงินของคนรับงาน
                const provInfo = await client.query(`SELECT currency_code FROM users WHERE user_id = $1`, [provider_id]);
                const provCurrency = provInfo.rows[0].currency_code; 

                // 🔄 แปลงสกุลเงินค่าคอม 
                if (provCurrency !== jobCurrency) {
                    const rateCheck = await client.query(`
                        SELECT currency_pair, rate FROM ExchangeRates WHERE currency_pair = $1 OR currency_pair = $2
                    `, [`${jobCurrency}_${provCurrency}`, `${provCurrency}_${jobCurrency}`]);
                    
                    if (rateCheck.rows.length > 0) {
                        const exRate = rateCheck.rows[0];
                        if (exRate.currency_pair === `${jobCurrency}_${provCurrency}`) {
                            rewardAmount = rewardAmount * parseFloat(exRate.rate);
                        } else {
                            rewardAmount = rewardAmount / parseFloat(exRate.rate);
                        }
                    }
                }

                // 💳 โอนเงินเข้า Wallet ผู้รับงาน (ใส่แค่ค่าคอม)
                await client.query(`UPDATE Wallets SET balance = balance + $1 WHERE user_id = $2`, [rewardAmount, provider_id]);
                
                await client.query(`
                    INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                    VALUES ($1, $2, 'P2P_Income', $3, 'Completed', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')
                `, [provider_id, rewardAmount, `รับค่าคอมมิชชั่นภารกิจฝาก P2P (งาน ID: ${request_id})`]);

                // ✅ 3. แจกคอมมิชชั่นให้ "ผู้แนะนำ" (แปลงสกุลเงินด้วย)
                const setDb = await client.query('SELECT referrer_reward_percent FROM P2P_Settings LIMIT 1');
                const refPercent = setDb.rows.length > 0 ? parseFloat(setDb.rows[0].referrer_reward_percent) : 0;

                if (refPercent > 0) {
                    const refCheck = await client.query(`
                        SELECT ref.user_id AS referrer_id, ref.currency_code AS ref_curr, me.username AS provider_name 
                        FROM users me 
                        INNER JOIN users ref ON me.referrer_username = ref.username 
                        WHERE me.user_id = $1
                    `, [provider_id]);
                    
                    if (refCheck.rows.length > 0 && refCheck.rows[0].referrer_id) {
                        const referrerId = refCheck.rows[0].referrer_id;
                        const providerName = refCheck.rows[0].provider_name; 
                        const refCurrency = refCheck.rows[0].ref_curr; 
                        
                        let finalRefReward = (parseFloat(job.amount) * refPercent) / 100; 

                        // 🔄 แปลงสกุลเงินค่าแนะนำ
                        if (refCurrency !== jobCurrency) {
                            const refRateCheck = await client.query(`
                                SELECT currency_pair, rate FROM ExchangeRates WHERE currency_pair = $1 OR currency_pair = $2
                            `, [`${jobCurrency}_${refCurrency}`, `${refCurrency}_${jobCurrency}`]);
                            
                            if (refRateCheck.rows.length > 0) {
                                const exRate2 = refRateCheck.rows[0];
                                if (exRate2.currency_pair === `${jobCurrency}_${refCurrency}`) {
                                    finalRefReward = finalRefReward * parseFloat(exRate2.rate);
                                } else {
                                    finalRefReward = finalRefReward / parseFloat(exRate2.rate);
                                }
                            }
                        }

                        await client.query(`UPDATE Wallets SET balance = balance + $1 WHERE user_id = $2`, [finalRefReward, referrerId]);
                        
                        await client.query(`
                            INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                            VALUES ($1, $2, 'Affiliate', $3, 'Completed', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')
                        `, [referrerId, finalRefReward, `ค่าคอมมิชชั่นแนะนำเพื่อนรับงาน P2P จากคุณ ${providerName} (งาน ID: ${request_id})`]);
                    }
                }

                // ✅ 4. ปิดงาน
                await client.query(`UPDATE P2P_Requests SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok' WHERE request_id = $1`, [request_id]);
                
            } else {
                // ❌ กรณีเงินไม่เข้า / สลิปปลอม
                
                // คืนเงินค้ำประกันเต็มจำนวน เพราะคนรับงานไม่ได้เงินเข้าธนาคาร
                await client.query(`UPDATE Wallets SET balance = balance + $1 WHERE user_id = $2`, [actualEscrow, provider_id]);
                
                await client.query(`
                    INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                    VALUES ($1, $2, 'P2P_Refund', $3, 'Completed', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')
                `, [provider_id, actualEscrow, `คืนเงินมัดจำ P2P เนื่องจากลูกค้าไม่โอนเงิน (งาน ID: ${request_id})`]);
                
                await client.query(`UPDATE P2P_Requests SET status = 'CANCELLED', completed_at = CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok' WHERE request_id = $1`, [request_id]);

                // 🌟 ระบบแบนบัญชีลูกค้า 
                const banCheck = await client.query(`
                    UPDATE users 
                    SET p2p_cancel_count = COALESCE(p2p_cancel_count, 0) + 1 
                    WHERE user_id = $1
                    RETURNING p2p_cancel_count
                `, [job.requester_id]);
                
                const maxStrikes = 3; 

                if (banCheck.rows[0].p2p_cancel_count >= maxStrikes) {
                    await client.query(`UPDATE users SET is_active = '0' WHERE user_id = $1`, [job.requester_id]); 
                }
            }

            await client.query('COMMIT');
            res.json({ success: true, message: is_correct ? '✅ จบภารกิจ! โอนเงินและจ่ายคอมมิชชั่นสำเร็จ' : '⚠️ ยกเลิกคำขอ และคืนเงินมัดจำให้คุณแล้ว' });

        } catch (innerErr) {
            await client.query('ROLLBACK');
            throw innerErr;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("Verify Slip Error:", err);
        res.status(400).json({ success: false, message: 'Server Error: ' + err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 4. [REQUESTER] ลูกค้ายืนยันการได้รับเงินโอน (ฝั่งถอนเงิน) - ฉบับสมบูรณ์ (แยก Transaction ยอดเงินต้น/ค่าคอม)
// ==========================================
app.post('/api/p2p/confirm-withdraw-receipt', async (req, res) => {
    try {
        const { requester_id, request_id, verify_status } = req.body;

        // 1. ตรวจสอบข้อมูลงาน
        const reqData = await pgPool.query(`SELECT * FROM P2P_Requests WHERE request_id = $1 AND requester_id = $2`, [request_id, requester_id]);
        
        if (reqData.rows.length === 0) {
            return res.status(400).json({ success: false, message: '❌ ไม่พบข้อมูลงาน หรือคุณไม่ใช่เจ้าของคำขอนี้' });
        }

        const job = reqData.rows[0];
        const provider_id = job.provider_id;
        const jobCurrency = job.currency; 

        if (job.status !== 'VERIFYING') {
            return res.status(400).json({ success: false, message: '⚠️ งานนี้ไม่ได้อยู่ในสถานะรอตรวจสอบสลิป' });
        }

        const client = await pgPool.connect(); // ใช้ Transaction
        await client.query('BEGIN');

        try {
            // 🌟 กรณีที่ 1: ถูกต้อง (ได้เงินครบ)
            if (verify_status === 'correct' || !verify_status) {
                
                // 💰 1. แยกคำนวณ "เงินต้น" และ "ค่าคอมมิชชั่น"
                let principalAmount = parseFloat(job.amount); 
                let rewardAmount = parseFloat(job.provider_reward); 

                // --- แปลงสกุลเงินผู้รับงาน ---
                const provInfo = await client.query(`SELECT currency_code FROM users WHERE user_id = $1`, [provider_id]);
                const provCurrency = provInfo.rows[0].currency_code;
                
                let exchangeRate = 1;

                if (provCurrency !== jobCurrency) {
                    const rateCheck = await client.query(`
                        SELECT currency_pair, rate FROM ExchangeRates WHERE currency_pair = $1 OR currency_pair = $2
                    `, [`${jobCurrency}_${provCurrency}`, `${provCurrency}_${jobCurrency}`]);
                    
                    if (rateCheck.rows.length > 0) {
                        const exRate = rateCheck.rows[0];
                        if (exRate.currency_pair === `${jobCurrency}_${provCurrency}`) {
                            exchangeRate = parseFloat(exRate.rate);
                        } else {
                            exchangeRate = 1 / parseFloat(exRate.rate);
                        }
                    }
                }

                // นำเรทมาคูณเพื่อแยกยอด
                let finalPrincipal = principalAmount * exchangeRate;
                let finalReward = rewardAmount * exchangeRate;
                let totalForProvider = finalPrincipal + finalReward;

                // 💳 โอนเงินเข้า Wallet ผู้รับงาน (เติมรวมยอด)
                await client.query(`UPDATE Wallets SET balance = balance + $1 WHERE user_id = $2`, [totalForProvider, provider_id]);

                // 📝 แยกลงประวัติ Transaction เป็น 2 รายการ
                await client.query(`
                    INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                    VALUES ($1, $2, 'P2P_Refund', $3, 'Completed', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok');
                `, [provider_id, finalPrincipal, `รับเงินคืนจากภารกิจถอน P2P (เงินต้น งาน ID: ${request_id})`]);

                await client.query(`
                    INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                    VALUES ($1, $2, 'P2P_Income', $3, 'Completed', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok');
                `, [provider_id, finalReward, `รับค่าคอมมิชชั่นภารกิจถอน P2P (งาน ID: ${request_id})`]);

                // 🎁 2. แจกคอมมิชชั่นให้ "ผู้แนะนำ" ของคนรับงาน 
                const setDb = await client.query('SELECT referrer_reward_percent FROM P2P_Settings LIMIT 1');
                const refPercent = setDb.rows.length > 0 ? parseFloat(setDb.rows[0].referrer_reward_percent) : 0;

                if (refPercent > 0) {
                    const refCheck = await client.query(`
                        SELECT ref.user_id AS referrer_id, ref.currency_code AS ref_curr, me.username AS provider_name 
                        FROM users me 
                        INNER JOIN users ref ON me.referrer_username = ref.username 
                        WHERE me.user_id = $1
                    `, [provider_id]);
                    
                    if (refCheck.rows.length > 0 && refCheck.rows[0].referrer_id) {
                        const referrerId = refCheck.rows[0].referrer_id;
                        const providerName = refCheck.rows[0].provider_name; 
                        const refCurrency = refCheck.rows[0].ref_curr; 
                        
                        let finalRefReward = (parseFloat(job.amount) * refPercent) / 100; 

                        if (refCurrency !== jobCurrency) {
                            const refRateCheck = await client.query(`
                                SELECT currency_pair, rate FROM ExchangeRates WHERE currency_pair = $1 OR currency_pair = $2
                            `, [`${jobCurrency}_${refCurrency}`, `${refCurrency}_${jobCurrency}`]);
                            
                            if (refRateCheck.rows.length > 0) {
                                const exRate2 = refRateCheck.rows[0];
                                if (exRate2.currency_pair === `${jobCurrency}_${refCurrency}`) {
                                    finalRefReward = finalRefReward * parseFloat(exRate2.rate);
                                } else {
                                    finalRefReward = finalRefReward / parseFloat(exRate2.rate);
                                }
                            }
                        }

                        await client.query(`UPDATE Wallets SET balance = balance + $1 WHERE user_id = $2`, [finalRefReward, referrerId]);
                        
                        await client.query(`
                            INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                            VALUES ($1, $2, 'Affiliate', $3, 'Completed', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok');
                        `, [referrerId, finalRefReward, `ค่าคอมมิชชั่นแนะนำเพื่อนรับงาน P2P จากคุณ ${providerName} (งาน ID: ${request_id})`]);
                    }
                }

                // 🏁 3. ปิดงาน
                await client.query(`UPDATE P2P_Requests SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok' WHERE request_id = $1`, [request_id]);

                await client.query('COMMIT');
                return res.json({ success: true, message: '✅ ยืนยันรับเงินสำเร็จ! ระบบได้โอนเงินและจ่ายค่าแนะนำเรียบร้อยแล้ว' });

            } 
            // 🌟 กรณีที่ 2: มีปัญหา (เงินไม่เข้า / ยอดไม่ตรง)
            else if (verify_status === 'no_money' || verify_status === 'wrong_amount') {
                
                await client.query(`UPDATE P2P_Requests SET status = 'DISPUTED' WHERE request_id = $1`, [request_id]);

                await client.query('COMMIT');
                return res.json({ success: true, message: '⚠️ ส่งเรื่องแจ้งปัญหาสำเร็จ! ระบบได้อายัดคำขอนี้ไว้เพื่อให้ Admin ตรวจสอบแล้ว' });
            }

        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("Confirm Withdraw Receipt Error:", err);
        res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 📤 [API] ลูกค้าอัปโหลดสลิปโอนเงิน
// ==========================================
app.post('/api/p2p/upload-slip', async (req, res) => {
    try {
        const { request_id, slip_url } = req.body; 

        // 🌟 ดักไว้เผื่อคนส่งรูปมาว่างเปล่า
        if (!slip_url) {
            return res.status(400).json({ success: false, message: 'กรุณาแนบรูปภาพสลิป' });
        }

        await pgPool.query(`
            UPDATE P2P_Requests 
            SET slip_url = $1, status = 'VERIFYING' 
            WHERE request_id = $2
        `, [slip_url, request_id]);

        res.json({ success: true, message: 'ส่งสลิปให้ผู้รับงานตรวจสอบเรียบร้อยแล้ว' });
    } catch (err) {
        console.error("🔥 [CRITICAL] Upload Slip Error แบบละเอียด:", err);
        
        // บังคับส่ง Error กลับไปให้หน้าเว็บแสดงผล
        res.status(500).json({ 
            success: false, 
            message: 'Server Error: ' + err.message,
            stack: err.stack
        });
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🚨 [API] ผู้รับงานดึงเงินกลับ (เลยเวลา) - แก้บัคสกุลเงิน & ทศนิยม
// ==========================================
app.post('/api/p2p/timeout-cancel', async (req, res) => {
    try {
        const { provider_id, request_id } = req.body;

        const setDb = await pgPool.query('SELECT * FROM P2P_Settings LIMIT 1');
        const settings = setDb.rows.length > 0 ? setDb.rows[0] : {};
        const timeoutMinutes = settings.request_timeout_minutes || 15; 
        const maxStrikes = 3;

        const reqData = await pgPool.query(`SELECT * FROM P2P_Requests WHERE request_id = $1 AND provider_id = $2 AND status = 'ACCEPTED'`, [request_id, provider_id]);

        if (reqData.rows.length === 0) {
            return res.json({ success: false, message: 'ไม่พบงานนี้ หรือสถานะงานถูกเปลี่ยนแปลงไปแล้ว' });
        }

        const job = reqData.rows[0];

        const timeCheck = await pgPool.query(`
            SELECT CASE 
                WHEN (COALESCE(accepted_at, created_at) + ($1 || ' minutes')::interval) < CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok' THEN 1 
                ELSE 0 
            END as is_expired 
            FROM P2P_Requests 
            WHERE request_id = $2
        `, [timeoutMinutes, request_id]);
        
        if (timeCheck.rows[0].is_expired === 0) {
            return res.json({ success: false, message: `⏳ ยังไม่หมดเวลาโอนเงินครับ (ระบบกำหนดเวลาไว้ ${timeoutMinutes} นาที)` });
        }

        const client = await pgPool.connect(); // ใช้ Transaction
        await client.query('BEGIN');

        try {
            // 🌟 ท่าไม้ตาย: ค้นหายอดค้ำประกัน "ของจริง"
            const escrowCheck = await client.query(`
                SELECT ABS(amount) as deducted_amount 
                FROM Transactions 
                WHERE user_id = $1 
                  AND title LIKE $2 
                  AND amount < 0
                ORDER BY transaction_id DESC
                LIMIT 1
            `, [provider_id, `%Job ID: ${request_id}%`]);
            
            const actualEscrow = escrowCheck.rows.length > 0 ? parseFloat(escrowCheck.rows[0].deducted_amount) : parseFloat(job.amount);

            // คืนเงินค้ำประกัน (ของจริง)
            await client.query(`UPDATE Wallets SET balance = balance + $1 WHERE user_id = $2`, [actualEscrow, provider_id]);
            
            await client.query(`
                INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                VALUES ($1, $2, 'P2P_Refund', $3, 'Completed', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')
            `, [provider_id, actualEscrow, `ดึงเงินมัดจำกลับ เนื่องจากลูกค้าไม่โอนเงิน (งาน ID: ${request_id})`]);

            // เปลี่ยนสถานะ
            await client.query(`UPDATE P2P_Requests SET status = 'CANCELLED', completed_at = CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok' WHERE request_id = $1`, [request_id]);

            // ลงโทษคนเบี้ยว
            const checkOffender = await client.query(`SELECT 1 FROM P2P_Offenders WHERE user_id = $1`, [job.requester_id]);
            let currentFails = 0;

            if (checkOffender.rows.length > 0) {
                const updateOffender = await client.query(`
                    UPDATE P2P_Offenders 
                    SET fail_count = fail_count + 1, last_offense_date = CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok' 
                    WHERE user_id = $1
                    RETURNING fail_count
                `, [job.requester_id]);
                currentFails = updateOffender.rows[0].fail_count;
            } else {
                const insertOffender = await client.query(`
                    INSERT INTO P2P_Offenders (user_id, fail_count, last_offense_date) 
                    VALUES ($1, 1, CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')
                    RETURNING fail_count
                `, [job.requester_id]);
                currentFails = insertOffender.rows[0].fail_count;
            }

            if (currentFails >= maxStrikes) {
                // สมมติว่าตาราง users ใช้คอลัมน์ is_active (คุณวิทยาสามารถปรับเป็น is_locked = 1 ถ้า DB ใช้ชื่อนั้นครับ)
                await client.query(`UPDATE users SET is_active = '0' WHERE user_id = $1`, [job.requester_id]);
            }

            await client.query('COMMIT');
            res.json({ success: true, message: '✅ ดึงเงินมัดจำกลับสำเร็จ และบันทึกประวัติทำผิดของลูกค้าเรียบร้อยแล้ว' });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("Timeout Cancel Error:", err);
        res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
    }
});
// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 [ADMIN] ดึงข้อมูลตั้งค่า P2P และโปรโมชั่น
// ==========================================
app.get('/api/admin/p2p-settings', async (req, res) => {
    try {
        const result = await pgPool.query('SELECT * FROM P2P_Settings ORDER BY id ASC LIMIT 1');
        
        if (result.rows.length > 0) {
            res.json({ success: true, settings: result.rows[0] });
        } else {
            res.status(404).json({ success: false, message: 'ไม่พบข้อมูลการตั้งค่า' });
        }
    } catch (err) {
        console.error("Error fetching P2P settings:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 [ADMIN] อัปเดตข้อมูลตั้งค่า P2P และโปรโมชั่น
// ==========================================
app.put('/api/admin/p2p-settings', async (req, res) => {
    try {
        const { 
            deposit_bonus_percent, withdraw_fee_percent, 
            provider_reward_percent, referrer_reward_percent, 
            request_timeout_minutes, promo_start_time, promo_end_time 
        } = req.body;

        // อัปเดตข้อมูลแถวแรกเสมอ (id = 1)
        await pgPool.query(`
            UPDATE P2P_Settings 
            SET deposit_bonus_percent = $1,
                withdraw_fee_percent = $2,
                provider_reward_percent = $3,
                referrer_reward_percent = $4,
                request_timeout_minutes = $5,
                promo_start_time = $6,
                promo_end_time = $7,
                updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok'
            WHERE id = 1
        `, [
            deposit_bonus_percent, 
            withdraw_fee_percent, 
            provider_reward_percent, 
            referrer_reward_percent, 
            request_timeout_minutes, 
            promo_start_time || null, 
            promo_end_time || null
        ]);

        res.json({ success: true, message: 'บันทึกการตั้งค่าสำเร็จ' });
    } catch (err) {
        console.error("Error updating P2P settings:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🛡️ [ADMIN] อัปเดตเฉพาะค่า Commission P2P (แยกต่างหาก ปลอดภัย 100%)
// ==========================================
app.post('/api/admin/p2p-commission-update', async (req, res) => {
    try {
        const { reward_percent } = req.body;
        
        // เช็คว่ามีข้อมูลในตารางหรือยัง ถ้ายังให้ Insert ถ้ามีแล้วให้ Update
        const check = await pgPool.query('SELECT CAST(COUNT(*) AS INTEGER) as count FROM P2P_Settings');
        
        if (check.rows[0].count === 0) {
            await pgPool.query(`INSERT INTO P2P_Settings (provider_reward_percent) VALUES ($1)`, [reward_percent]);
        } else {
            await pgPool.query(`UPDATE P2P_Settings SET provider_reward_percent = $1`, [reward_percent]);
        }
        res.json({ success: true, message: 'บันทึกค่า Commission P2P สำเร็จแล้ว! (มีผลเฉพาะบิลใหม่)' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🛡️ [API] ดึงประวัติงาน P2P ที่กำลังดำเนินการของผู้รับงาน
// ==========================================
app.get('/api/p2p/my-jobs/:uid', async (req, res) => {
    try {
        const uid = req.params.uid;
        
        const result = await pgPool.query(`
            SELECT * FROM P2P_Requests 
            WHERE provider_id = $1 
              AND status IN ('ACCEPTED', 'VERIFYING')
            ORDER BY accepted_at DESC
        `, [uid]);
            
        res.json({ success: true, jobs: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 [CLIENT] ดึงข้อมูลหน้าบอร์ดลูกค้า (ฉบับสมบูรณ์ที่สุด - รวมร่างข้อดีและแก้บัคแล้ว)
// ==========================================
app.get('/api/p2p/board', async (req, res) => {
    try {
        const { user_id } = req.query;
        if (!user_id) return res.status(400).json({ success: false, message: 'Missing user_id' });
        
        const rateResult = await pgPool.query('SELECT * FROM ExchangeRates');
        const settingResult = await pgPool.query('SELECT * FROM P2P_Settings LIMIT 1');
        
        // 🌟 แก้ปัญหา Timezone เซิร์ฟเวอร์ให้ตรงกับเวลาไทย/ลาว +7 (จากตัวที่ 2)
        const activePromoResult = await pgPool.query(`
            SELECT * FROM P2P_Promotions 
            WHERE CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok' BETWEEN start_time AND end_time 
            ORDER BY end_time ASC
            LIMIT 1
        `);
        
        // 🌟 ดึงข้อมูลกระเป๋า และ สกุลเงิน (เปลี่ยนเป็น currency_code ให้ตรง DB) (จากตัวที่ 2)
        const walletResult = await pgPool.query(`
            SELECT w.balance, u.currency_code 
            FROM Wallets w 
            LEFT JOIN Users u ON w.user_id = u.user_id 
            WHERE w.user_id = $1
        `, [user_id]);
        
        // 🌟 ดึงเฉพาะ "งานว่าง" และเช็คว่า "ยังไม่หมดเวลา" (เพิ่ม JOIN ธนาคาร เพื่อไม่ให้กระทบโค้ดเดิม)
        const missionsResult = await pgPool.query(`
            SELECT r.*, u.username AS requester_name,
                   bk.bank_name AS req_bank_name, bk.logo_url, bk.country,
                   ub.account_number AS req_account_number,
                   ub.account_name AS req_account_name
            FROM P2P_Requests r 
            LEFT JOIN Users u ON r.requester_id = u.user_id 
            LEFT JOIN UserBanks ub ON r.user_bank_id = ub.user_bank_id
            LEFT JOIN Banks bk ON ub.bank_id = bk.bank_id
            WHERE r.status = 'PENDING' 
              AND r.requester_id != $1 
              AND r.expires_at > CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok'
            ORDER BY r.created_at DESC
        `, [user_id]);

        // 🌟 ดึง "งานที่รับมาแล้ว" (ใช้ท่าเดียวกันเป๊ะ!)
        const myAcceptedResult = await pgPool.query(`
            SELECT r.*, u.username AS requester_name,
                   bk.bank_name AS req_bank_name, bk.logo_url, bk.country,
                   ub.account_number AS req_account_number,
                   ub.account_name AS req_account_name
            FROM P2P_Requests r 
            LEFT JOIN Users u ON r.requester_id = u.user_id 
            LEFT JOIN UserBanks ub ON r.user_bank_id = ub.user_bank_id
            LEFT JOIN Banks bk ON ub.bank_id = bk.bank_id
            WHERE r.provider_id = $1 AND r.status IN ('ACCEPTED', 'VERIFYING')
            ORDER BY r.created_at DESC
        `, [user_id]);

      // 🌟 แยกตะกร้าดึง "งานที่ฉันเป็นคนสร้าง" พร้อมเชื่อม 3 ตาราง (Requests + UserBanks + Banks) เพื่อดึงชื่อธนาคารให้ครบ!
        const myRequestsResult = await pgPool.query(`
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
            WHERE r.requester_id = $1 
            ORDER BY r.created_at DESC
        `, [user_id]);

        // 🌟 ส่งข้อมูลแบบจัดเต็ม ครบจบใน API เดียว
        res.json({ 
            success: true, 
            settings: settingResult.rows[0] || null, 
            activePromo: activePromoResult.rows.length > 0 ? activePromoResult.rows[0] : null,
            wallet: walletResult.rows.length > 0 ? parseFloat(walletResult.rows[0].balance) : 0, 
            currency: (walletResult.rows.length > 0 && walletResult.rows[0].currency_code) ? walletResult.rows[0].currency_code : 'THB',
            exchangeRates: rateResult.rows || [],
            missions: missionsResult.rows || [], 
            myAcceptedJobs: myAcceptedResult.rows || [], 
            myRequests: myRequestsResult.rows || [] 
        });
    } catch (err) { 
        console.error(err);
        res.status(500).json({ success: false, message: err.message }); 
    }
});
// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 API ใหม่: ดึงเฉพาะโฆษณา/วิดีโอ (ดึงแค่ครั้งเดียวตอนลูกค้าเปิดหน้าเว็บ)
// ==========================================
app.get('/api/p2p/active-ads', async (req, res) => {
    try {
        // ดึงเฉพาะโฆษณาที่ is_active = '1' (เปิดใช้งานอยู่)
        const result = await pgPool.query(`
            SELECT * FROM P2P_Ads 
            WHERE is_active = '1' 
            ORDER BY sort_order ASC, created_at DESC
        `);
        res.json({ success: true, ads: result.rows });
    } catch (err) { 
        res.status(500).json({ success: false, message: err.message }); 
    }
});
// ==========================================
// 🌟 สิ้นสุด  API P2P
// ==========================================


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🌟 [ADMIN] ADS และ โปรโมชั่น  เริ่ม
// ==========================================

// 1. จัดการคิวโปรโมชั่น (แจกโบนัสฝาก)
app.get('/api/admin/promotions', async (req, res) => {
    try {
        const result = await pgPool.query('SELECT * FROM P2P_Promotions ORDER BY start_time ASC');
        res.json({ success: true, promotions: result.rows });
    } catch (err) { 
        res.status(500).json({ success: false, message: err.message }); 
    }
});

app.post('/api/admin/promotions', async (req, res) => {
    try {
        const { title, bonus_percent, start_time, end_time } = req.body;
        await pgPool.query(`
            INSERT INTO P2P_Promotions (title, bonus_percent, start_time, end_time) 
            VALUES ($1, $2, CAST($3 AS TIMESTAMP), CAST($4 AS TIMESTAMP))
        `, [title, bonus_percent, start_time, end_time]);
            
        res.json({ success: true, message: 'เพิ่มโปรโมชั่นสำเร็จ' });
    } catch (err) { 
        res.status(500).json({ success: false, message: err.message }); 
    }
});

app.delete('/api/admin/promotions/:id', async (req, res) => {
    try {
        await pgPool.query('DELETE FROM P2P_Promotions WHERE promo_id = $1', [req.params.id]);
        res.json({ success: true, message: 'ลบสำเร็จ' });
    } catch (err) { 
        res.status(500).json({ success: false, message: err.message }); 
    }
});

// 2. จัดการป้ายโฆษณาคั่นเวลา (ADS)
app.get('/api/admin/ads', async (req, res) => {
    try {
        const result = await pgPool.query('SELECT * FROM P2P_Ads ORDER BY created_at DESC');
        res.json({ success: true, ads: result.rows });
    } catch (err) { 
        res.status(500).json({ success: false, message: err.message }); 
    }
});

app.post('/api/admin/ads', async (req, res) => {
    try {
        const { title, description, media_type, media_url } = req.body;
        await pgPool.query(`
            INSERT INTO P2P_Ads (title, description, media_type, media_url) 
            VALUES ($1, $2, $3, $4)
        `, [title || '', description || '', media_type, media_url]);
            
        res.json({ success: true, message: 'เพิ่มโฆษณาสำเร็จ' });
    } catch (err) { 
        res.status(500).json({ success: false, message: err.message }); 
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// ✏️ API สำหรับแก้ไขโฆษณา (อัปเดตข้อความ + รูปปก)
// ==========================================
app.put('/api/admin/ads/:id', async (req, res) => {
    const { id } = req.params;
    // 🌟 รับค่าที่แก้ไขมาจากหน้าบ้าน
    const { title, description, thumbnail_url } = req.body; 
    
    try {
        await pgPool.query(
            // 🌟 สั่งอัปเดต 3 ฟิลด์
            'UPDATE video_promotions SET title = $1, description = $2, thumbnail_url = $3 WHERE id = $4',
            [title, description, thumbnail_url, id]
        );
        res.json({ success: true, message: 'อัปเดตข้อมูลสำเร็จ' });
    } catch (error) {
        console.error("Update Ad Error:", error);
        res.status(500).json({ success: false, message: 'อัปเดตข้อมูลไม่สำเร็จ' });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🗑️ API สำหรับลบโฆษณา
// ==========================================
app.delete('/api/admin/ads/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        // ลบออกจากฐานข้อมูล Vercel Postgres (ข้อมูล Like, Comment, Share จะโดนลบตามอัตโนมัติเพราะเราตั้ง ON DELETE CASCADE ไว้ตอนสร้างตารางครับ)
        await pgPool.query('DELETE FROM video_promotions WHERE id = $1', [id]);
        res.json({ success: true, message: 'ลบข้อมูลสำเร็จ' });
    } catch (error) {
        console.error("Delete Ad Error:", error);
        res.status(500).json({ success: false, message: 'ลบข้อมูลไม่สำเร็จ' });
    }
});

// ==========================================
// 🌟 [ADMIN] ADS และ โปรโมชั่น  สิ้นสุด
// ==========================================

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 💸 [CLIENT] สร้างคำขอถอนเงิน (P2P) - อัปเดตบันทึกบัญชีธนาคาร
// ==========================================
app.post('/api/p2p/request-withdraw', async (req, res) => {
    try {
        // 🌟 1. รับค่า user_bank_id ที่ลูกค้าเลือกมาจากหน้าเว็บ
        const { requester_id, amount, user_bank_id } = req.body; 
        
        if (!requester_id || !amount || amount <= 0 || !user_bank_id) {
            return res.status(400).json({ success: false, message: 'กรุณาระบุจำนวนเงินและเลือกบัญชีธนาคาร' });
        }

        const client = await pgPool.connect(); // 🌟 ใช้ Transaction
        await client.query('BEGIN');

        try {
            const userCheck = await client.query(`
                SELECT u.currency_code, w.balance 
                FROM users u 
                LEFT JOIN Wallets w ON u.user_id = w.user_id 
                WHERE u.user_id = $1
            `, [requester_id]);
                
            if (userCheck.rows.length === 0) throw new Error('ไม่พบข้อมูลผู้ใช้');
            
            const userCurrency = userCheck.rows[0].currency_code;
            const currentBalance = parseFloat(userCheck.rows[0].balance || 0);
            const reqAmount = parseFloat(amount);

            if (currentBalance < reqAmount) throw new Error('ยอดเงินไม่เพียงพอ');

            const settings = await client.query('SELECT * FROM P2P_Settings LIMIT 1');
            const config = settings.rows.length > 0 ? settings.rows[0] : {};
            const feePercent = parseFloat(config.withdraw_fee_percent || 5);
            const feeAmount = (reqAmount * feePercent) / 100;
            const netAmount = reqAmount - feeAmount; 
            const providerReward = (netAmount * parseFloat(config.provider_reward_percent || 15)) / 100;

            // 🛡️ หักเงินในกระเป๋า (ป้องกันการกดเบิ้ลรัวๆ)
            const updateWallet = await client.query(`
                UPDATE Wallets SET balance = balance - $1 WHERE user_id = $2 AND balance >= $1
            `, [reqAmount, requester_id]);

            if (updateWallet.rowCount === 0) {
                throw new Error('ยอดเงินในกระเป๋าไม่เพียงพอ หรือมีการทำรายการซ้อนทับกันครับ');
            }

            // บันทึกประวัติ Transaction ฝั่ง Wallet
            await client.query(`
                INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                VALUES ($1, $2, 'P2P_Withdraw_Hold', 'หักเงินเพื่อสร้างคำขอถอนเงิน P2P', 'Pending', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')
            `, [requester_id, -reqAmount]);
            
            // 🌟 2. บันทึกคำขอถอนเงิน (แทรก user_bank_id ลงฐานข้อมูลให้เรียบร้อย และบวกเวลา expires_at ด้วย interval)
            await client.query(`
                INSERT INTO P2P_Requests 
                (requester_id, user_bank_id, request_type, currency, amount, bonus_or_fee, net_amount, provider_reward, status, created_at, expires_at) 
                VALUES 
                ($1, $2, 'WITHDRAW', $3, $4, $5, $6, $7, 'PENDING', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok') + ($8 || ' minutes')::interval)
            `, [
                requester_id, 
                user_bank_id, 
                userCurrency, 
                reqAmount, 
                feeAmount, 
                netAmount, 
                providerReward, 
                parseInt(config.request_timeout_minutes || 15)
            ]);

            await client.query('COMMIT');
            res.json({ success: true, message: 'สร้างคำขอถอนเงินสำเร็จ' });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("Request Withdraw Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🏦 [GET] ดึงข้อมูลเตรียมถอนเงิน (Wallet + Banks + Logo)
// ==========================================
app.get('/api/p2p/withdraw-info/:userId', async (req, res) => {
    try {
        const uid = parseInt(req.params.userId, 10);
        if (!uid) return res.status(400).json({ success: false, message: 'Invalid ID' });

        // 1. ดึงข้อมูล Wallet
        const userDb = await pgPool.query(`
            SELECT currency_code, COALESCE((SELECT balance FROM Wallets WHERE user_id = $1), 0) as balance 
            FROM users WHERE user_id = $1
        `, [uid]);
        
        if (userDb.rows.length === 0) return res.json({ success: false, message: 'ไม่พบผู้ใช้' });
        
        const { currency_code, balance } = userDb.rows[0];

        // 2. ดึงบัญชีธนาคารที่อนุมัติแล้ว พร้อมดึง logo_url, currency_code และ country
        const banksDb = await pgPool.query(`
            SELECT ub.user_bank_id, ub.account_number, ub.currency_code, bk.bank_name, bk.logo_url, bk.country 
            FROM UserBanks ub
            LEFT JOIN Banks bk ON ub.bank_id = bk.bank_id
            WHERE ub.user_id = $1 AND (ub.status = 'Approved' OR ub.status = 'APPROVED')
        `, [uid]);
            
        // 3. ดึงค่าธรรมเนียม
        const setDb = await pgPool.query('SELECT withdraw_fee_percent FROM P2P_Settings LIMIT 1');
        const feePercent = setDb.rows.length > 0 ? parseFloat(setDb.rows[0].withdraw_fee_percent) : 5;

        // 4. อัตราแลกเปลี่ยนสำรอง
        let usdRate = currency_code === 'THB' ? 35 : currency_code === 'LAK' ? 22000 : 1; 

        res.json({
            success: true,
            currency: currency_code,
            balance: parseFloat(balance),
            fee_percent: feePercent,
            usd_rate: usdRate,
            banks: banksDb.rows // 🌟 ส่งรายชื่อบัญชี (พร้อมโลโก้) ไปให้หน้าเว็บ
        });
    } catch (err) {
        console.error("withdraw-info API Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🚫 [API] ลูกค้ายกเลิกคำขอถอนเงินที่ยังไม่มีคนรับ
// ==========================================
app.post('/api/p2p/cancel-withdraw-request', async (req, res) => {
    try {
        const { request_id, requester_id } = req.body;
        if (!request_id || !requester_id) return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });

        const client = await pgPool.connect(); // ใช้ Transaction
        await client.query('BEGIN');

        try {
            const reqCheck = await client.query(`
                SELECT amount, currency, status, expires_at 
                FROM P2P_Requests 
                WHERE request_id = $1 AND requester_id = $2 AND request_type = 'WITHDRAW'
            `, [request_id, requester_id]);

            if (reqCheck.rows.length === 0) throw new Error('ไม่พบคำขอ หรือคุณไม่มีสิทธิ์ยกเลิกคำขอนี้');
            const requestData = reqCheck.rows[0];

            // 🌟 เช็คเวลาปัจจุบัน เทียบกับเวลาหมดอายุ
            const now = new Date();
            const expiresAt = new Date(requestData.expires_at);
            const isExpired = now > expiresAt;

            // 🌟 กฎการยกเลิก: ถ้าไม่ใช่ PENDING และไม่ได้หมดเวลา จะยกเลิกไม่ได้
            if (requestData.status !== 'PENDING' && !(requestData.status === 'ACCEPTED' && isExpired)) {
                throw new Error('ไม่สามารถยกเลิกได้ เนื่องจากผู้รับงานกำลังดำเนินการและยังไม่หมดเวลาครับ');
            }

            const refundAmount = parseFloat(requestData.amount); 

            await client.query(`UPDATE P2P_Requests SET status = 'CANCELLED' WHERE request_id = $1`, [request_id]);

            await client.query(`UPDATE Wallets SET balance = balance + $1 WHERE user_id = $2`, [refundAmount, requester_id]);

            await client.query(`
                INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                VALUES ($1, $2, 'P2P_Withdraw_Refund', $3, 'Completed', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')
            `, [requester_id, refundAmount, `คืนเงินยกเลิกคำขอถอนเงิน P2P (Job ID: ${request_id})`]);

            await client.query('COMMIT');
            res.json({ success: true, message: 'ยกเลิกคำขอและคืนเงินเข้ากระเป๋าเต็มจำนวนสำเร็จครับ' });

        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 📋 [GET] ดึงรายการงาน P2P ที่ฉันรับมาดูแล (ฝั่งผู้รับงาน)
// ==========================================
app.get('/api/p2p/my-jobs/:userId', async (req, res) => {
    try {
        const pid = parseInt(req.params.userId, 10);
        
        // 🌟 ดึงแบบตรงไปตรงมา ผ่าน user_bank_id เหมือนหน้าบอร์ดเลยครับ!
        const jobsDb = await pgPool.query(`
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
            WHERE r.provider_id = $1 
              AND r.status IN ('ACCEPTED', 'VERIFYING')
            ORDER BY r.request_id DESC
        `, [pid]);
            
        res.json({ success: true, jobs: jobsDb.rows });
    } catch (err) {
        console.error("My Jobs API Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 📋 [GET] ดึงประวัติคำขอถอนเงินของลูกค้า (ดึงข้อมูลฝั่งผู้รับงานมาด้วย)
// ==========================================
app.get('/api/p2p/my-requests/:userId', async (req, res) => {
    try {
        const uid = req.params.userId;
        if (!uid || uid === 'undefined') return res.status(400).json({ success: false, message: 'Invalid ID' });

        // 🌟 แปลง OUTER APPLY ของ SQL Server ให้อยู่ในรูป LEFT JOIN เพื่อรองรับ PostgreSQL
        const reqDb = await pgPool.query(`
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
            
            -- 🌟 ดึงบัญชีของผู้รับงาน ที่ผูกกับระบบและตรงกับสกุลเงินของงาน
            LEFT JOIN (
                SELECT DISTINCT ON (user_id, currency_code) user_id, currency_code, account_number, bank_id
                FROM UserBanks
                WHERE status = 'Approved' OR status = 'APPROVED'
                ORDER BY user_id, currency_code, user_bank_id DESC
            ) pb ON pb.user_id = r.provider_id AND pb.currency_code = r.currency
            
            LEFT JOIN Banks pbk ON pb.bank_id = pbk.bank_id
            
            WHERE r.requester_id = $1 AND r.request_type = 'WITHDRAW'
            ORDER BY r.request_id DESC
        `, [parseInt(uid, 10)]);
            
        res.json({ success: true, requests: reqDb.rows });
    } catch (err) {
        console.error("My Requests API Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 📤 [POST] อัปโหลดสลิปโอนเงิน (พร้อมระบบ Anti-Fraud + การคืนเงินที่ปลอดภัย 100%)
// ==========================================
app.post('/api/p2p/provider-upload-slip', async (req, res) => {
    try {
        const { provider_id, request_id, slip_image, transfer_amount, transfer_date, transfer_time } = req.body;
        
        // 🕵️‍♂️ โค้ดนักสืบ: ตรวจทีละตัวว่าใครหายไป
        let missingFields = [];
        if (!provider_id) missingFields.push('provider_id (รหัสผู้รับงาน)');
        if (!request_id) missingFields.push('request_id (รหัสงาน)');
        if (!slip_image) missingFields.push('slip_image (รูปสลิป)');
        if (!transfer_amount) missingFields.push('transfer_amount (ยอดเงิน)');
        if (!transfer_date) missingFields.push('transfer_date (วันที่โอน)');
        if (!transfer_time) missingFields.push('transfer_time (เวลาที่โอน)');

        if (missingFields.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: `❌ ข้อมูลส่งมาไม่ครบ! ตัวที่ขาดหายไปคือ: ${missingFields.join(', ')}` 
            });
        }

        // 1. ดึงข้อมูลงานมาตรวจสอบ
        const jobCheck = await pgPool.query(`SELECT * FROM P2P_Requests WHERE request_id = $1 AND provider_id = $2 AND status = 'ACCEPTED'`, [request_id, provider_id]);
        
        if (jobCheck.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'ไม่พบงานนี้ หรือสถานะงานไม่ถูกต้อง' });
        }

        const job = jobCheck.rows[0];
        const expectedAmount = parseFloat(job.net_amount);
        const inputAmount = parseFloat(transfer_amount);

        // 🚨 2. ระบบตรวจสอบเจตนาทุจริต (Anti-Fraud)
        if (inputAmount !== expectedAmount) {
            const currentErrorCount = (job.slip_error_count || 0) + 1;

            if (currentErrorCount >= 3) {
                // 💥 ทุจริตครบ 3 ครั้ง: ใช้ Transaction คืนเงินตามสูตรของเจ้านายเป๊ะๆ
                const client = await pgPool.connect();
                await client.query('BEGIN');

                try {
                    // 2.1 บล็อกผู้รับงาน
                    await client.query(`UPDATE Users SET status = 'Blocked' WHERE user_id = $1`, [provider_id]);

                    // 2.2 ยกเลิกงาน
                    await client.query(`UPDATE P2P_Requests SET status = 'CANCELLED' WHERE request_id = $1`, [request_id]);

                    // 2.3 คืนเงินเข้ากระเป๋าผู้ส่งคำขอถอน
                    const refundAmount = parseFloat(job.amount);
                    await client.query(`UPDATE Wallets SET balance = balance + $1 WHERE user_id = $2`, [refundAmount, job.requester_id]);

                    // 2.4 บันทึกประวัติ Transaction
                    await client.query(`
                        INSERT INTO Transactions (user_id, amount, transaction_type, title, status, created_at) 
                        VALUES ($1, $2, 'P2P_Withdraw_Refund', $3, 'Completed', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')
                    `, [job.requester_id, refundAmount, `คืนเงินระบบ P2P เนื่องจากผู้รับงานทุจริต (Job ID: ${request_id})`]);

                    // 2.5 ส่งแจ้งเตือนหาลูกค้า
                    try {
                        await client.query(`
                            INSERT INTO Notifications (user_id, message, type, is_read, created_at)
                            VALUES ($1, $2, 'SYSTEM', '0', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')
                        `, [job.requester_id, 'ผู้รับงานมีเจตนาทุจริต ผู้รับงานโดนบล็อกแล้ว ให้ส่งคำขอใหม่ (เราได้คืนเงินกลับให้คุณแล้วกรุณาตรวจสอบ)']);
                    } catch (notiErr) {}

                    await client.query('COMMIT'); 

                    return res.status(403).json({ 
                        success: false, 
                        message: '🚨 บัญชีของคุณถูกระงับการใช้งาน! เนื่องจากตรวจพบเจตนาทุจริต กรุณาติดต่อ Admin' 
                    });

                } catch (transactionErr) {
                    await client.query('ROLLBACK');
                    throw transactionErr;
                } finally {
                    client.release();
                }

            } else {
                // ⚠️ กรอกผิดแต่ยังไม่ครบ 3 ครั้ง: อัปเดตตัวนับและแจ้งเตือน
                await pgPool.query(`UPDATE P2P_Requests SET slip_error_count = $1 WHERE request_id = $2`, [currentErrorCount, request_id]);

                return res.status(400).json({ 
                    success: false, 
                    message: `❌ ยอดเงินไม่ถูกต้อง! คุณต้องระบุยอดโอนให้ตรงกับที่ระบบกำหนด คือ ${expectedAmount.toLocaleString()} ${job.currency}\n(เตือนครั้งที่ ${currentErrorCount}/3 หากผิดครบ 3 ครั้งบัญชีจะถูกระงับและยกเลิกงาน!)` 
                });
            }
        }
        // 🌟 3. ถ้ายอดเงินตรงกันเป๊ะ: บันทึกข้อมูลและเปลี่ยนสถานะเป็น VERIFYING
        await pgPool.query(`
            UPDATE P2P_Requests 
            SET slip_url = $1, 
                transfer_amount = $2,
                transfer_date = CAST($3 AS DATE),
                transfer_time = CAST($4 AS TIME), 
                slip_error_count = 0, 
                status = 'VERIFYING' 
            WHERE request_id = $5
        `, [slip_image, inputAmount, transfer_date, transfer_time, request_id]);

        res.json({ success: true, message: '✅ ส่งหลักฐานสำเร็จ! ระบบบันทึกข้อมูลและส่งให้ลูกค้าตรวจสอบแล้ว' });

    } catch (err) {
        console.error("Upload Slip Error:", err);
        res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
    }
});
// ==========================================
// 🌟 API P2P ฝั่งถอนเงิน สิ้นสุด
// ==========================================

// ==========================================
// 🌟 ย้ายไป database ใหม่ และแก้ไขแล้ว
// 🔔 [NOTIFICATION APIs]
// ==========================================

// 1. ดึงรายการแจ้งเตือนทั้งหมดของ User (เฉพาะที่ยังไม่ลบ)
app.get('/api/notifications/:userId', async (req, res) => {
    try {
        const uid = parseInt(req.params.userId, 10);
        const result = await pgPool.query(`
            SELECT notification_id, title, message, type, is_read, created_at
            FROM Notifications
            WHERE user_id = $1 AND (is_deleted = '0' OR is_deleted IS NULL)
            ORDER BY created_at DESC
        `, [uid]);

        // เช็คจำนวนที่ยังไม่อ่าน โดยรองรับทั้ง boolean และ String '0'
        const unreadCount = result.rows.filter(n => n.is_read === false || n.is_read === '0').length;
        res.json({ success: true, notifications: result.rows, unreadCount });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 2. ปรับสถานะเป็นอ่านแล้ว (Mark as Read)
app.post('/api/notifications/read', async (req, res) => {
    try {
        const { notification_id, user_id } = req.body;
        await pgPool.query(`UPDATE Notifications SET is_read = '1' WHERE notification_id = $1 AND user_id = $2`, [notification_id, user_id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 3. ปรับสถานะเป็นลบ (Soft Delete - ไม่ลบจริง)
app.post('/api/notifications/delete', async (req, res) => {
    try {
        const { notification_id, user_id } = req.body;
        await pgPool.query(`UPDATE Notifications SET is_deleted = '1' WHERE notification_id = $1 AND user_id = $2`, [notification_id, user_id]);
        res.json({ success: true, message: 'ลบการแจ้งเตือนเรียบร้อยแล้ว' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


// ==========================================
// 🌟 ใช้งานได้เหมือนเดิม 100% ไม่พึ่งพา DB
// 🎥 API สำหรับขอ URL อัปโหลดจาก Cloudflare Stream
// ==========================================
app.post('/api/get-upload-url', async (req, res) => {
    try {
        // ดึงค่ามาจาก Railway Variables
        const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
        const CF_API_TOKEN = process.env.CF_API_TOKEN;

        // ไม่ต้องใช้ node-fetch แล้ว เพราะ Node.js เวอร์ชั่นใหม่มี fetch ให้ใช้เลย
        const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/direct_upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CF_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                maxDurationSeconds: 3600, // อัปโหลดวิดีโอได้ยาวสุด 1 ชั่วโมง
                creator: "salapi"
            })
        });

        const data = await response.json();

        if (data.success) {
            res.json({
                success: true,
                uploadUrl: data.result.uploadURL,
                uid: data.result.uid
            });
        } else {
            console.error("❌ Cloudflare API Error:", data.errors);
            res.status(400).json({ success: false, message: 'Cloudflare ปฏิเสธการขอ URL' });
        }
    } catch (error) {
        console.error("❌ Get Upload URL Error:", error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// ==========================================
// 💾 API สำหรับบันทึกข้อมูลโปรโมชั่นวิดีโอลง Vercel Postgres (อัปเดตเพิ่มรูปปก)
// ==========================================
app.post('/api/video-promotions', async (req, res) => {
    // 🌟 รับค่า thumbnail_url ที่หน้าบ้านส่งมาเพิ่ม
    const { title, description, cf_video_id, thumbnail_url } = req.body;

    if (!title || !cf_video_id) {
        return res.status(400).json({ success: false, message: 'กรุณากรอกหัวข้อและอัปโหลดวิดีโอด้วยครับ' });
    }

    try {
        // 🌟 แก้ไขคำสั่ง SQL ให้เพิ่มช่อง thumbnail_url (เป็น $4)
        const query = `
            INSERT INTO video_promotions (title, description, cf_video_id, thumbnail_url)
            VALUES ($1, $2, $3, $4)
            RETURNING *;
        `;
        const values = [title, description, cf_video_id, thumbnail_url];
        
        const result = await pgPool.query(query, values);
        
        res.json({ 
            success: true, 
            message: 'บันทึกโปรโมชั่นสำเร็จ!', 
            data: result.rows[0] 
        });
        
    } catch (error) {
        console.error("Database Insert Error:", error);
        res.status(500).json({ success: false, message: 'บันทึกลงฐานข้อมูลไม่สำเร็จ' });
    }
});


// ==========================================
// 📺 API สำหรับดึงข้อมูลวิดีโอโปรโมชั่น (อัปเดตเพิ่มดึงรูปปก)
// ==========================================
app.get('/api/video-promotions', async (req, res) => {
    try {
        const { username } = req.query; 
        
        let query;
        let params = [];
        
        if (username) {
             query = `
                SELECT v.*, 
                EXISTS(SELECT 1 FROM video_likes WHERE video_id = v.id AND username = $1) as is_liked
                FROM video_promotions v 
                ORDER BY created_at DESC;
            `;
            params = [username];
        } else {
             query = `SELECT *, false as is_liked FROM video_promotions ORDER BY created_at DESC;`;
        }

        const result = await pgPool.query(query, params);

        const formattedVideos = result.rows.map(video => {
            return {
                ad_id: video.id,
                title: video.title,
                description: video.description,
                media_type: 'video', 
                media_url: `https://customer-a6fkepv8oxw1um16.cloudflarestream.com/${video.cf_video_id}/manifest/video.m3u8`,
                // 🌟 ดึงข้อมูล thumbnail_url ส่งกลับไปให้หน้าบ้านด้วย
                thumbnail_url: video.thumbnail_url,
                
                likes_count: video.likes_count,
                views_count: video.views_count,
                shares_count: video.shares_count,
                comments_count: video.comments_count,
                is_liked: video.is_liked 
            };
        });

        res.json({ success: true, ads: formattedVideos });
    } catch (error) {
        console.error("❌ Get Video Error:", error);
        res.status(500).json({ success: false, message: 'ดึงข้อมูลวิดีโอไม่สำเร็จ' });
    }
});


// ==========================================
// ❤️ API กด Like / Unlike วิดีโอ
// ==========================================
app.post('/api/video/like', async (req, res) => {
    const { video_id, username } = req.body;
    if (!video_id || !username) return res.status(400).json({ success: false });

    try {
        // เช็คก่อนว่าเคย Like หรือยัง
        const checkRes = await pgPool.query('SELECT 1 FROM video_likes WHERE video_id = $1 AND username = $2', [video_id, username]);
        
        if (checkRes.rows.length > 0) {
            // ถ้าเคย Like แล้ว = สั่ง Un-like (ลบออก)
            await pgPool.query('DELETE FROM video_likes WHERE video_id = $1 AND username = $2', [video_id, username]);
            await pgPool.query('UPDATE video_promotions SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = $1', [video_id]);
            res.json({ success: true, action: 'unliked' });
        } else {
            // ถ้ายังไม่เคย Like = สั่ง Like (เพิ่มเข้าไป)
            await pgPool.query('INSERT INTO video_likes (video_id, username) VALUES ($1, $2)', [video_id, username]);
            await pgPool.query('UPDATE video_promotions SET likes_count = likes_count + 1 WHERE id = $1', [video_id]);
            res.json({ success: true, action: 'liked' });
        }
    } catch (error) {
        console.error("Like Error:", error);
        res.status(500).json({ success: false });
    }
});

// ==========================================
// 👁️ API นับยอด View
// ==========================================
app.post('/api/video/view', async (req, res) => {
    const { video_id } = req.body;
    if (!video_id) return res.status(400).json({ success: false });
    try {
        await pgPool.query('UPDATE video_promotions SET views_count = views_count + 1 WHERE id = $1', [video_id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});


// ==========================================
// 🔄 API นับยอด Share และเก็บประวัติผู้ใช้
// ==========================================
app.post('/api/video/share', async (req, res) => {
    const { video_id, username } = req.body;
    if (!video_id) return res.status(400).json({ success: false });
    
    try {
        // 1. บวกยอดแชร์รวม
        await pgPool.query('UPDATE video_promotions SET shares_count = shares_count + 1 WHERE id = $1', [video_id]);
        
        // 2. ถ้ามีการล็อกอิน (มี username) ให้เก็บลงตารางประวัติ
        if (username) {
            await pgPool.query('INSERT INTO video_shares (video_id, username) VALUES ($1, $2)', [video_id, username]);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error("Share Error:", error);
        res.status(500).json({ success: false });
    }
});

// ==========================================
// 🚀 Start Server
// ==========================================
app.listen(port, () => {
    console.log(`🚀 Server เปิดทำงานแล้วที่พอร์ต ${port} (Powered by PostgreSQL)`);
});