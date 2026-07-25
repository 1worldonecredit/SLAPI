require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sql = require('mssql');

const app = express();
const port = process.env.PORT || 5000;

// อนุญาตให้หน้าเว็บจากโดเมนของคุณเรียกใช้ API ได้
// กำหนด URL ที่อนุญาตให้เข้าถึง API ได้ (ลบช่องว่างส่วนเกินออก และปรับเป็นตัวเล็กเพื่อความชัวร์)
const allowedOrigins = [
  'https://salapi.company', 
  'https://api.salapi.company',
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
app.use(express.json());

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
// 1. API สำหรับ Login
// ==========================================
app.post('/api/login', async (req, res) => {
  // รับข้อมูล username และ password ที่ Frontend ส่งมา
  const { username, password } = req.body;

  try {
    // เชื่อมต่อฐานข้อมูล
    const pool = await sql.connect(dbConfig);
    
    // ดึงข้อมูล User พร้อมกับ Role, Level และ ชื่อ-นามสกุล
    const userResult = await pool.request()
      .input('username', sql.VarChar, username)
      .query(`
        SELECT 
          u.user_id, u.username, u.password_hash, u.wallet_balance, u.total_orders, u.is_active,
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

    // เนื่องจากในฐานข้อมูลทดสอบของคุณ ช่อง password_hash บันทึกเป็นคำว่า "hashed_1234"
    // เราเลยใช้การเทียบข้อความตรงๆ ไปก่อนครับ
    if (password === user.password_hash) {
      validPassword = true;
    } 
    
    /* 
      หมายเหตุ: อนาคตถ้าใช้รหัสผ่านที่เข้ารหัสด้วย bcrypt ให้ลบ if ด้านบนออกแล้วใช้โค้ดนี้แทน:
      const bcrypt = require('bcrypt');
      validPassword = await bcrypt.compare(password, user.password_hash);
    */

    // ถ้ารหัสผ่านไม่ตรง
    if (!validPassword) {
      return res.status(401).json({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    // ถ้าผ่านหมด ส่งข้อมูลกลับไปให้ Frontend (ซ่อนรหัสผ่านไว้ ไม่ส่งกลับไป)
    res.json({
      message: 'เข้าสู่ระบบสำเร็จ',
      user: {
        user_id: user.user_id,
        username: user.username,
        firstname: user.firstname || 'ผู้ใช้',
        lastname: user.lastname || 'ทั่วไป',
        role: user.role_name,
        level: user.level_name,
        wallet: user.wallet_balance || 0.00,
        point: 0 // ถ้ามีตาราง point ค่อยมาดึงใส่ทีหลัง
      }
    });

  } catch (err) {
    console.error('Login API Error:', err);
    res.status(500).json({ message: 'ระบบขัดข้อง ไม่สามารถเชื่อมต่อฐานข้อมูลได้' });
  }
});

app.listen(port, () => {
    console.log(`🚀 Server เปิดทำงานแล้วที่พอร์ต ${port}`);
});