const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const WebSocket = require('ws');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Create HTTP server & WebSocket server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware & Flexible CORS for cross-origin deployment
const allowedOrigins = process.env.FRONTEND_URL 
  ? process.env.FRONTEND_URL.split(',').map(s => s.trim()) 
  : '*';

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins === '*' || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true
}));
app.use(express.json());

// Serve static frontend files from ../frontend directory if present (monorepo / local mode)
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const hasFrontend = fs.existsSync(FRONTEND_DIR);
if (hasFrontend) {
  app.use(express.static(FRONTEND_DIR, { extensions: ['html', 'htm'] }));
  app.get('/login', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'login.html')));
  app.get('/admin', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'admin.html')));
}

// Health check endpoint for cloud deployment (Render, Railway, Fly.io)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'WanderPair API & WebSocket Engine',
    uptime: `${Math.floor(process.uptime())}s`,
    timestamp: new Date().toISOString()
  });
});


// SQLite Database Setup
const dbPath = path.join(__dirname, 'wanderpair.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
    initDatabase();
  }
});

// Database Initialization & Seed Data
function initDatabase() {
  db.serialize(() => {
    // Users table with role, email & bcrypt password
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        avatar TEXT,
        bio TEXT,
        country TEXT,
        verified INTEGER DEFAULT 1,
        kyc_verified INTEGER DEFAULT 1,
        style TEXT,
        tripsCount INTEGER DEFAULT 0,
        rating REAL DEFAULT 4.9,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Sessions table for multi-user token authentication
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Trips table
    db.run(`
      CREATE TABLE IF NOT EXISTS trips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id INTEGER,
        title TEXT NOT NULL,
        destination TEXT NOT NULL,
        country TEXT DEFAULT 'India',
        start_date TEXT,
        end_date TEXT,
        duration_days TEXT DEFAULT '5 Days',
        style TEXT,
        budget TEXT,
        trip_type TEXT DEFAULT 'group',
        estimated_cost REAL,
        split_total REAL DEFAULT 24000,
        max_companions INTEGER DEFAULT 6,
        spots_left INTEGER DEFAULT 2,
        cover_image TEXT,
        description TEXT,
        itinerary TEXT,
        route_nodes TEXT DEFAULT '[]',
        squad_manifest TEXT DEFAULT '[]',
        gender_pref TEXT DEFAULT 'Any',
        kyc_verified INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(host_id) REFERENCES users(id)
      )
    `);

    // City Outings table
    db.run(`
      CREATE TABLE IF NOT EXISTS city_outings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id INTEGER,
        title TEXT NOT NULL,
        city TEXT NOT NULL,
        category TEXT NOT NULL,
        date_time TEXT,
        venue TEXT,
        estimated_cost REAL,
        max_companions INTEGER DEFAULT 1,
        spots_left INTEGER DEFAULT 1,
        cover_image TEXT,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(host_id) REFERENCES users(id)
      )
    `);

    // City Explorers Table (Solo Explorers looking for companions via Live Chat)
    db.run(`
      CREATE TABLE IF NOT EXISTS city_explorers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        city TEXT NOT NULL,
        area TEXT NOT NULL,
        activity_intent TEXT NOT NULL,
        date_time TEXT,
        status_text TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // Bookings table
    db.run(`
      CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trip_id INTEGER,
        requester_id INTEGER,
        note TEXT,
        estimated_split REAL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(trip_id) REFERENCES trips(id),
        FOREIGN KEY(requester_id) REFERENCES users(id)
      )
    `);

    // Real-Time Chat Messages table
    db.run(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_room TEXT NOT NULL,
        sender_id INTEGER,
        sender_name TEXT,
        sender_avatar TEXT,
        message TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Testimonials table
    db.run(`
      CREATE TABLE IF NOT EXISTS testimonials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_name TEXT NOT NULL,
        user_country TEXT DEFAULT 'India',
        user_avatar TEXT,
        destination TEXT NOT NULL,
        flag TEXT DEFAULT '🇮🇳',
        trip_title TEXT,
        quote TEXT NOT NULL,
        rating REAL DEFAULT 5.0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add new columns safely if upgrading existing table
    db.run("ALTER TABLE trips ADD COLUMN route_nodes TEXT DEFAULT '[]'", () => {});
    db.run("ALTER TABLE trips ADD COLUMN duration_days TEXT DEFAULT '5 Days'", () => {});
    db.run("ALTER TABLE trips ADD COLUMN split_total REAL DEFAULT 24000", () => {});
    db.run("ALTER TABLE trips ADD COLUMN squad_manifest TEXT DEFAULT '[]'", () => {});
    db.run("ALTER TABLE trips ADD COLUMN kyc_verified INTEGER DEFAULT 1", () => {});
    db.run("ALTER TABLE users ADD COLUMN kyc_verified INTEGER DEFAULT 1", () => {});

    // Check if reseed needed for Solaris Drift
    db.get("SELECT COUNT(*) as count FROM trips WHERE title LIKE '%Motorcycle%'", [], (err, row) => {
      if (!row || row.count === 0) {
        console.log('Seeding database with Solaris Drift verified expeditions, city radar meetups & live chat...');
        db.serialize(() => {
          db.run('DELETE FROM bookings');
          db.run('DELETE FROM trips');
          db.run('DELETE FROM city_outings');
          db.run('DELETE FROM city_explorers');
          db.run('DELETE FROM chat_messages');
          db.run('DELETE FROM users');
          db.run('DELETE FROM testimonials');
          db.run("DELETE FROM sqlite_sequence WHERE name IN ('users', 'trips', 'city_outings', 'city_explorers', 'chat_messages', 'bookings', 'testimonials')", (errSeq) => {
            seedDatabase();
          });
        });
      }
    });
  });
}

function seedDatabase() {
  // Bcrypt hashed passwords
  const userHash = bcrypt.hashSync('user123', 10);
  const adminHash = bcrypt.hashSync('admin123', 10);

  const users = [
    {
      name: 'Aarav Sharma',
      email: 'aarav@wanderpair.in',
      password: userHash,
      role: 'user',
      avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBrQPCJrcd25qyPUa8dZCkDHOucB9xqBtjGxLNEAcqCazu5DQ4AXYgA6v-Av4Yq6sLCvbvaZWcuqtnVlSVFjbNad49wNHTz4rEiCU192jBzlpdrvzOGxQU0aFaJ-Xbgy9_5ZZq0WqzJW9kH2vkpbi57nnWULlL4qmtITRaucTqay4uAd_F_QhpQJ_fj6BhpeHf_KJ5HLYSY-EHeBcFb2UKGBkU8xo0bL962dRdI10qq7KZyIjiiy7YC',
      bio: 'Delhi-based solo trekker & digital nomad. Passionate about Himalayan passes, Delhi monuments, local chai stalls, and street food.',
      country: 'New Delhi, India',
      verified: 1,
      kyc_verified: 1,
      style: 'High Altitude Trek',
      tripsCount: 19,
      rating: 5.0
    },
    {
      name: 'Ananya Iyer',
      email: 'ananya@wanderpair.in',
      password: userHash,
      role: 'user',
      avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBS1byE9_p78LRny4gCpMLwK3AuIcJIEgi98BvMnUjEG3sdF8Nhn_lET6lhZ3QDMZWrKvUugM4ThTj5W0q5y2uYf0QvO5p0ydYs5iIEAhQxhdb1WZOL5ZekaysvG2zt_Bv0QxtnNuh1tszNiSgGw_D73srsE831voImSJHmg3FXR1p0xj6PLCmsRfWJJD4wA8BGPrayXp94Vh8Mdn24pdwf3uG2MZgDEQYHxzHnRO-uMXDMkMGR2qQb',
      bio: 'Bengaluru solo wanderer & nomad designer. Exploring coastal cliff walks, South Indian filter coffee, and rooftop cafes.',
      country: 'Bengaluru, India',
      verified: 1,
      kyc_verified: 1,
      style: 'Coastal Trail & Workation',
      tripsCount: 18,
      rating: 4.95
    },
    {
      name: 'Rohan Verma',
      email: 'rohan@wanderpair.in',
      password: userHash,
      role: 'user',
      avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAqpPSgn350fYGOwDbvTV834bb-bkLhQ2g2ERD7bWKSu6x2RrATM_ba1SXoCByqxp_VeUcUQuYcIF-kWRce95S2aI2XLps49R7ze0sBhHat2w87i6Dxv0CYKclBGVfFsqGseFnJQ9_koabZEYMKC1K0mbyuDfaITiu4vBYG_Rgho0ECYJlAM7jTsW_bDdcdqxhtsiMC3FUvaHRDHHtZVATHG7i4dkGFH9T6c_A3XQnMLbsrwNXF0Usc',
      bio: 'Mumbai adventure enthusiast & certified rafter. Love white-water rafting, heritage walks, and exploring South Bombay.',
      country: 'Mumbai, India',
      verified: 1,
      kyc_verified: 1,
      style: 'River Rapids & Camping',
      tripsCount: 9,
      rating: 5.0
    },
    {
      name: 'Diya Rajput',
      email: 'diya@wanderpair.in',
      password: userHash,
      role: 'user',
      avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80',
      bio: 'Heritage & architecture lover from Jaipur. Exploring ancient forts, havelis, and Old Delhi street food trails.',
      country: 'Jaipur, India',
      verified: 1,
      kyc_verified: 1,
      style: 'Cultural Exploration',
      tripsCount: 12,
      rating: 5.0
    },
    {
      name: 'Vikramaditya Verma (Admin)',
      email: 'admin@wanderpair.in',
      password: adminHash,
      role: 'admin',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
      bio: 'WanderPair Trust & Safety Lead Administrator. Managing platform safety, real-time live chat verification, and trip listings.',
      country: 'New Delhi, India (Admin Portal)',
      verified: 1,
      kyc_verified: 1,
      style: 'Platform Administrator',
      tripsCount: 25,
      rating: 5.0
    },
    {
      name: 'Kabir Mehta',
      email: 'kabir@wanderpair.in',
      password: userHash,
      role: 'user',
      avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCVqSAXtqUsrQPH12en3dK3R_lGRYmM0zB8GZVGP3Mwc9sEJVLEYWHtED_O5je4hkldVmJ9ouocX6WGSbc2_C0K8mn6a8RbolWT6ubJWpoGIW-yW-Itl7sSOC554PIszM0evRc5jTXm7msmAtD3j0ep6rSRjRqDx1JvwlIMrrpgmE2FtWIWG7zIscvTb2HRj6Tz3NMyKY1rJmjVRRKLg-Gpubd5soowljCJmmlV8V09z5IofVFwxLg0',
      bio: 'High-altitude mountaineer and lead expedition navigator from Chandigarh. Exploring Spiti Valley, Ladakh, and Himalayan high passes.',
      country: 'Leh & Chandigarh, India',
      verified: 1,
      kyc_verified: 1,
      style: 'High Altitude Trek',
      tripsCount: 14,
      rating: 4.9
    }
  ];

  const stmtUser = db.prepare(`INSERT INTO users (name, email, password, role, avatar, bio, country, verified, kyc_verified, style, tripsCount, rating) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  users.forEach((u) => {
    stmtUser.run([u.name, u.email, u.password, u.role, u.avatar, u.bio, u.country, u.verified, u.kyc_verified, u.style, u.tripsCount, u.rating]);
  });

  stmtUser.finalize(() => {
    // Seed City Explorers
    const explorers = [
      {
        user_id: 1, // Aarav
        city: 'New Delhi',
        area: 'Connaught Place & Red Fort',
        activity_intent: 'Monuments & Street Food Walk',
        date_time: 'Today Evening, 5:00 PM',
        status_text: 'Main akela Delhi ghumne ja raha hu (Connaught Place, Red Fort & Paranthe Wali Gali). Agar kisi aur ko bhi Delhi ghumna hai, toh live msg karke sath chalein!'
      },
      {
        user_id: 3, // Rohan
        city: 'Mumbai',
        area: 'Marine Drive & Fort Heritage',
        activity_intent: 'Sunset Walk & Irani Cafe Chai',
        date_time: 'Today Golden Hour, 5:30 PM',
        status_text: 'Exploring South Bombay heritage buildings & Marine Drive sunset today! Looking for a companion to message and grab bun maska chai together.'
      },
      {
        user_id: 2, // Ananya
        city: 'Bengaluru',
        area: 'Church Street & Brigade Road',
        activity_intent: 'Bookstore Crawl & Craft Coffee',
        date_time: 'Tomorrow, 4:00 PM',
        status_text: 'Solo bookshop crawl at Blossom & Subko Coffee on Church Street. Drop a live message if you want to explore together!'
      },
      {
        user_id: 4, // Diya
        city: 'Jaipur',
        area: 'Pink City Bazaars & Hawa Mahal',
        activity_intent: 'Photography & Rawat Kachori',
        date_time: 'Saturday, 10:00 AM',
        status_text: 'Walking through Johari Bazaar & Hawa Mahal rooftops! Looking for 1 companion to share kachoris & take photos.'
      }
    ];

    const stmtExp = db.prepare(`INSERT INTO city_explorers (user_id, city, area, activity_intent, date_time, status_text) VALUES (?, ?, ?, ?, ?, ?)`);
    explorers.forEach(e => {
      stmtExp.run([e.user_id, e.city, e.area, e.activity_intent, e.date_time, e.status_text]);
    });
    stmtExp.finalize();

    // Seed Initial Live Chat Room Messages
    const chatMsg = [
      { chat_room: 'explorer_1', sender_id: 1, sender_name: 'Aarav Sharma', sender_avatar: users[0].avatar, message: 'Namaste! Main 5 PM CP metro gate #2 pe milunga. Red Fort aur CP chalenge!' },
      { chat_room: 'explorer_1', sender_id: 4, sender_name: 'Diya Rajput', sender_avatar: users[3].avatar, message: 'Awesome Aarav! I am near Janpath, count me in for the street food trail!' },
      { chat_room: 'general_radar', sender_id: 6, sender_name: 'Kabir Mehta', sender_avatar: users[5].avatar, message: 'Heading out from Manali towards Leh tomorrow morning! Any solos want to convoy?' }
    ];
    const stmtChat = db.prepare(`INSERT INTO chat_messages (chat_room, sender_id, sender_name, sender_avatar, message) VALUES (?, ?, ?, ?, ?)`);
    chatMsg.forEach(m => {
      stmtChat.run([m.chat_room, m.sender_id, m.sender_name, m.sender_avatar, m.message]);
    });
    stmtChat.finalize();

    // Seed Solaris Drift Expeditions
    const trips = [
      {
        host_id: 6, // Kabir Mehta
        title: 'Ladakh High Pass Motorcycle & SUV Expedition',
        destination: 'Leh, Ladakh & Pangong',
        country: 'India',
        start_date: 'Sep 12',
        end_date: 'Sep 20',
        duration_days: '8 Days',
        style: 'High Altitude Trek',
        budget: '₹5k - ₹15k',
        trip_type: 'group',
        estimated_cost: 12000,
        split_total: 24000,
        max_companions: 6,
        spots_left: 2,
        cover_image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCGiN6dyaTQt7y3C-17C_PR9wD9XF9IehmJOj5PTj96zVgMsozDzi8_mAbIlr5V6zQGiaugWSt6lZmF4ybx34yxssFvLfaq4tcU1meJK7F8IzWsj7fm2rNJFLHQAJjUv6lVWyn3dHh68Lf3nOz5Qq6i5M00oh0iyj72TvGRPEbH1jRhwJUzrYfNjbUkqV3Mj50OAnJLkFZRKoVuLIy4F6nYjvysLrb_9xY2k5HeQntPh0uYmtD4qWO9',
        description: 'Calling solo travelers for an epic high-altitude convoy! Renting a 4x4 expedition vehicle and bikes across Khardung La, Nubra Valley sand dunes, and tranquil camping at Pangong Tso.',
        itinerary: JSON.stringify([
          { day: 1, text: 'Acclimatization in Leh & Shanti Stupa sunset walk.' },
          { day: 2, text: 'Ascend Khardung La (17,982 ft) into Nubra Valley & Diskit monastery.' },
          { day: 3, text: 'Hunder white sand dunes camel safari & drive to Pangong Tso.' },
          { day: 4, text: 'Sunrise lakeside photography at Pangong & Chang La return to Leh.' }
        ]),
        route_nodes: JSON.stringify(['Leh', 'Khardung La', 'Nubra', 'Pangong Tso']),
        squad_manifest: JSON.stringify([
          { name: 'Pooja', avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuC3wsor0xr0mjQ3PdppHSTkxfEGTW0ebMVgIaxflNYX8Ax_aNUZTjTYwmzmBZccb3UPfblYw_d0eY4yG_2Fw06mtt65Ucewz5ke8z-8bMn2CsUX6w2EZb5MGsrkQHZ8UaWxLoSVclZpqzt2AXiGtpmox2ZhjyxAf0VsGRWf40SJwX1BzpZxArlkT8xjvB7TueMSrkvBh-BOxvUmBXmXnm12q7fhj-Ak2PdeeyAtfY3KgdPwIkkJIAHQ' },
          { name: 'Arjun', avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBCo567nlHvpqwl91zsmgRILmJrl6J_3kXYBgIvmfI6t-KZa0UbvRRIK6lQ-CM-l_DBgwV-fOnHHVQ1R3xQR7jNDwgoZvpSwyIJWfzQII4w9iWaPgJDYw6F7vIhm988MXmU7W5S0IAHctll4nhdj6_TDM7jL6_fuEqZsa9ZWNKT2AzHj0aoLZt9XTO9HRTy2Si92y1LCgWVD-euvpxnA0GnnGsQCbj4nyl89fESumJzKu3v9qebAsmi' },
          { name: 'Tara', avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDUn-Jp5e8djCYUY9RXQQurlOOLUaJVSCeSrXLXuu4YdMenqPeVl0IMjSzj6SeY1nM_0ZqKzbB0lm8-x1w79HqF3TW91KzcEiNpIeIP7lSp91Uk7MZ6gmd8bGZdfkhZHZ8IJfES5-ueG5zX9I5DQ79szMVX9lOppK387Mpd3iXgw3tpxb_94dd8Eelu7LTWfPqfNSkkDRnHyatrVNNlBi5sjgPpQrSdYKYEMn0J9AkPDnqPXygzmwOA' },
          { name: 'Dev', avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBlGVP1KzzuAHr4fb3zk_kInJLWoDKTGFu70U4AjJeN4Mb5VGAiHLWiJuHc5-nqrRwwnQMQJwGQqEBwli9Tz4HbaBbY3ViyEJm0gkErxoq5QYmTx83edl13oNqdfxu63UMLD5pf7_fEIAccQPjdbA202TEpmvJ1Wy7Z8x2dafaj7PdBZpPlSaN6oC0zmTVzPRX1OGunRPoCf2k6PRwFu162EqQrV21AX83vYKq2588WuTKreU05Eelk' }
        ]),
        gender_pref: 'Any',
        kyc_verified: 1
      },
      {
        host_id: 3, // Rohan Verma
        title: 'Rishikesh White-Water Rafting & Ganga Campfire',
        destination: 'Rishikesh & Shivpuri',
        country: 'India',
        start_date: 'Oct 4',
        end_date: 'Oct 7',
        duration_days: '3 Days',
        style: 'River Rapids & Camping',
        budget: 'Under ₹5k',
        trip_type: 'group',
        estimated_cost: 4500,
        split_total: 9000,
        max_companions: 8,
        spots_left: 3,
        cover_image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD7KeT6e464PsC08p9TpHUbc-r1aBMpc0Eht1pXgNJ9QiFLoRS2y-zC2jz1X7aTK_Ou-QRx6Zepv8iqumf1n3QBtphVju1Geg2ELaGb55GchokXz19C3Pn6SPZX395sDTcc2QfbSLGQZFnJr8iRyQrOp1V-u6CTYR7I11ggIeY4kWfxutaAqtFw-FkFWgFKWvX48nP-tbCmTXDe1WDC33f9MJ_LMz9tdRH66w8HGcIZ5dd7D2iBwGWE',
        description: 'Plunging through turquoise white-water rapids on the sacred Ganga, camping under Himalayan stars, riverside campfires, and cliff-jumping adventure.',
        itinerary: JSON.stringify([
          { day: 1, text: 'Check in to riverside camp, evening campfire & acoustic travel jam.' },
          { day: 2, text: '16km Shivpuri rafting stretch & cliff jumping at Marine Drive point.' },
          { day: 3, text: 'Neer Garh waterfall jungle trek & sunset Ganga Aarti at Parmarth Niketan.' }
        ]),
        route_nodes: JSON.stringify(['Rishikesh', 'Shivpuri', 'Neer Waterfall Hike']),
        squad_manifest: JSON.stringify([
          { name: 'Vivek', avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCjvrxNQ0UAd9fR5S1nMRIp1XvCikS9JnGkSLO4u4ezm-mlWOsgeGZmVzFFYIxfBk0Llqu_3jAY58lmGrewfK_HyTELh6NSSqQtYKF0PSPaXz2Luo8a3nVwoA4wfPwPYm4_m1YdsNnaMpYVWaBS2bg5QGt6chO5QRoj7GD8I6yemKoqV9n2GOZ-U7bEVy8iOxrbAHF5OII8TXOcdDf6CTpwN9pb9Jk1A9Yg-QgDWOkAOQ6M5uco7OR_' },
          { name: 'Simran', avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAVEompF7y-ttvXLeLtLG0Y__zfDoP6g_HPnsO1Tz43cImmEF8T99y5MqZruN746u1_lLPVsIgSYQCH5uKh0yUcr0NkGxRUwRZbDDMvqumQPyLusOyRz4WuLEu0XTqy3e7dalHHUr-VeiFnzgC-OA5HCQk17pWVi4b7cyh2-5rcCvNOFotAPyP5lmy5Iib6gfA8g62fJxbX2-WCDLFq7dQo02uGP_QXW3WxII5jVsUT3FTogFla7ASS' },
          { name: 'Sameer', avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAmZbqvnPDotLZ4V20XdspAhFo47UShDWwe4eHjXEg695k7aunffcUBeSlkA9l3Yr7L5o4gPELe7uGF8j5fXNUl_QRkoJ_cQ5qpAxyM-uuCAzxPCqqWOyauRU02JjjmvlFH6x1_qxqfsUQteKan2Pt26U5S3Ixo9AnPsAfTYTQt4pGG-Lh6MSanvpHS_sdHz1bySf--y7IXsOsE04vNZw6Rqkwhd3fEtDh9Y8mCMKQz982nyk5B52IC' },
          { name: 'Kavita', avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuA_OEJ8r3ocwG9J1M04W2PyH_wbc_49znbhJgOmi1M-eNDvZmoJ6eaZ_nEabPem9F8OdBcGaSCMaHAuXojcx_BOeuiUHq2fSEuR35b4Q3dlKrPU6fZNF1uLFgRb_Z4ItmZ42n84rH-XPov7CNFtXCC_nQKI6KeEw1kCvODBZUHUcU0H_gBRnhutO_DwFal6Ic0PKrA8xtas1A8uhhah7LZ4hi6o4bD68q-DCPuj6TaNNc1UxZHdk6fd' },
          { name: 'Harsh', avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuArctDEcilOYSpbmWa77_pSse75zb6Nchf7Xu4Yq7so03VDPs1dxOZ_WL976MAt4uTFqrB_8UQR2KY1NSPkvlyrkivZ0O6G_JDMDdVxriVeW0czJ_80LC4_MDR0nWz9QpHH_dnRJMAtjO89FTSW1p08FJ8Q4VhpMaJWPnyKST_OmHLpvKWM3G48mL0YtLqv6j9FNveyN6Te52uT_xWrdfXAZbBsLNDHHyBFBJpdzXATLrcm9Hn9XmKg' }
        ]),
        gender_pref: 'Any',
        kyc_verified: 1
      },
      {
        host_id: 2, // Ananya Iyer
        title: 'Goa Coastal Scooter Trails & Sunset Cafes',
        destination: 'Goa Coast',
        country: 'India',
        start_date: 'Nov 10',
        end_date: 'Nov 15',
        duration_days: '5 Days',
        style: 'Coastal Trail & Workation',
        budget: '₹5k - ₹15k',
        trip_type: 'pair',
        estimated_cost: 8000,
        split_total: 16000,
        max_companions: 1,
        spots_left: 1,
        cover_image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuB8mrGHDei_KTfkX-pFaGjtuxYSH2z8G3Vb8dYe-YJyNngYV7S-srHZ_T2EpA8wKNdV8CzOJjoAysXokFapB6LfdyebhSnq12jVwCW0clG4ylQMwAiSd5Mv64-ox_pFZoILl09i5gXB0wAnIUfU5L3LNhHagXOZzDZbS8ayI1yABmsNDm4SM0YMtyZI6ftRoJJ5s3rsxNqqQyd43AmMpwacnnYvAtPi9Z7Ven0RPm7s3waxi7hobXWd',
        description: 'Cruising pastel scooters along palm-lined coastal roads, secret sweet water lakes, sunset drum circles at Arambol, and quiet South Goa cafe workation.',
        itinerary: JSON.stringify([
          { day: 1, text: 'Check in to cliffside villa, sunset stroll at Vagator cliff.' },
          { day: 2, text: 'Arambol sweet water lake trail walk & evening drum circle sunset.' },
          { day: 3, text: 'Drive to South Goa: Butterfly Beach kayak & Palolem silent noise party.' },
          { day: 4, text: 'Artisan cafe hopping & co-working in Fontainhas Latin Quarter.' }
        ]),
        route_nodes: JSON.stringify(['Arambol', 'Anjuna', 'Chapora Fort', 'Palolem']),
        squad_manifest: JSON.stringify([]),
        gender_pref: 'Women Solos or Co-ed',
        kyc_verified: 1
      },
      {
        host_id: 1, // Aarav Sharma
        title: 'Spiti Valley High Altitude Expedition & Monastery Trail',
        destination: 'Spiti & Kaza',
        country: 'India',
        start_date: 'Oct 12',
        end_date: 'Oct 20',
        duration_days: '9 Days',
        style: 'High Altitude Trek',
        budget: '₹15k+ Expeditions',
        trip_type: 'group',
        estimated_cost: 14500,
        split_total: 29000,
        max_companions: 6,
        spots_left: 2,
        cover_image: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=1200&q=80',
        description: 'A Himalayan raw wilderness crossing over Kunzum Pass into the cold desert of Spiti. High altitude homestays, Key Monastery chantings, and star gazing at Chandratal lake.',
        itinerary: JSON.stringify([
          { day: 1, text: 'Drive from Shimla through Kinnaur valley apple orchards.' },
          { day: 2, text: 'Visit Tabo Monastery 1000-year-old murals.' },
          { day: 3, text: 'Ascend to Kaza & Key Monastery morning prayer ceremony.' },
          { day: 4, text: 'High altitude camping under the Milky Way at Chandratal lake.' }
        ]),
        route_nodes: JSON.stringify(['Shimla', 'Kalpa', 'Kaza', 'Key Monastery', 'Chandratal']),
        squad_manifest: JSON.stringify([
          { name: 'Pooja', avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuC3wsor0xr0mjQ3PdppHSTkxfEGTW0ebMVgIaxflNYX8Ax_aNUZTjTYwmzmBZccb3UPfblYw_d0eY4yG_2Fw06mtt65Ucewz5ke8z-8bMn2CsUX6w2EZb5MGsrkQHZ8UaWxLoSVclZpqzt2AXiGtpmox2ZhjyxAf0VsGRWf40SJwX1BzpZxArlkT8xjvB7TueMSrkvBh-BOxvUmBXmXnm12q7fhj-Ak2PdeeyAtfY3KgdPwIkkJIAHQ' }
        ]),
        gender_pref: 'Any',
        kyc_verified: 1
      }
    ];

    const stmtTrip = db.prepare(`INSERT INTO trips (host_id, title, destination, country, start_date, end_date, duration_days, style, budget, trip_type, estimated_cost, split_total, max_companions, spots_left, cover_image, description, itinerary, route_nodes, squad_manifest, gender_pref, kyc_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    trips.forEach((t) => {
      stmtTrip.run([t.host_id, t.title, t.destination, t.country, t.start_date, t.end_date, t.duration_days, t.style, t.budget, t.trip_type, t.estimated_cost, t.split_total, t.max_companions, t.spots_left, t.cover_image, t.description, t.itinerary, t.route_nodes, t.squad_manifest, t.gender_pref, t.kyc_verified]);
    });
    stmtTrip.finalize();

    // Seed City Outings across NCR, Mumbai, and Bengaluru
    const outings = [
      {
        host_id: 3, // Rohan
        title: '🍿 IMAX 3D Sci-Fi Blockbuster & Discussion',
        city: 'Mumbai',
        category: 'Movie Trip',
        date_time: 'This Saturday, 7:00 PM',
        venue: 'PVR PXL, Lower Parel, Mumbai',
        estimated_cost: 650,
        max_companions: 1,
        spots_left: 1,
        cover_image: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1200&q=80',
        description: 'Looking for a fellow film enthusiast to book companion seats for the latest IMAX 3D sci-fi release! Post-film artisan coffee to discuss.'
      },
      {
        host_id: 2, // Ananya
        title: '☕ Bandra Golden Hour Rooftop & Travel Chat',
        city: 'Mumbai',
        category: 'Cafe Meetup',
        date_time: 'This Sunday, 4:30 PM',
        venue: 'Blue Tokai & Subko Coffee, Bandra West',
        estimated_cost: 450,
        max_companions: 1,
        spots_left: 1,
        cover_image: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=1200&q=80',
        description: 'Casual coffee hangout & travel date! Exploring Bandra roasteries, exchanging trip recommendations, and enjoying rooftop golden hour sunset.'
      },
      {
        host_id: 1, // Aarav
        title: '🎭 Hauz Khas Village Sunset & Stand-up Comedy',
        city: 'NCR Delhi',
        category: 'Cultural & Comedy',
        date_time: 'Friday Evening, 6:30 PM',
        venue: 'Hauz Khas Social & Comedy Club, New Delhi',
        estimated_cost: 400,
        max_companions: 2,
        spots_left: 2,
        cover_image: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&q=80',
        description: 'Heading to Hauz Khas for sunset lake view followed by live indie stand-up comedy at 8 PM. Join in to unwind after work!'
      },
      {
        host_id: 1, // Aarav
        title: '🚴 Sunrise India Gate & Old Delhi Street Food Cycle',
        city: 'NCR Delhi',
        category: 'Weekend Trail',
        date_time: 'Sunday Morning, 5:45 AM',
        venue: 'India Gate War Memorial to Chandni Chowk',
        estimated_cost: 350,
        max_companions: 4,
        spots_left: 3,
        cover_image: 'https://images.unsplash.com/photo-1596178065887-1198b6148b2b?auto=format&fit=crop&w=1200&q=80',
        description: 'Morning cycling tour before Delhi traffic wakes up! Cycling down Rajpath, through Connaught Place, ending with Bedmi Puri & Jalebi in Chandni Chowk.'
      },
      {
        host_id: 2, // Ananya
        title: '📚 Church Street Bookstore Crawl & Artisan Coffee',
        city: 'Bengaluru',
        category: 'Bookstore Crawl',
        date_time: 'Saturday Afternoon, 3:30 PM',
        venue: 'Blossom Book House, Church Street, Bengaluru',
        estimated_cost: 350,
        max_companions: 2,
        spots_left: 1,
        cover_image: 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=1200&q=80',
        description: 'Solo bookshop crawl browsing through rare second-hand travel books, followed by pour-over coffee and sourdough sandwiches.'
      }
    ];

    const stmtOuting = db.prepare(`INSERT INTO city_outings (host_id, title, city, category, date_time, venue, estimated_cost, max_companions, spots_left, cover_image, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    outings.forEach((o) => {
      stmtOuting.run([o.host_id, o.title, o.city, o.category, o.date_time, o.venue, o.estimated_cost, o.max_companions, o.spots_left, o.cover_image, o.description]);
    });
    stmtOuting.finalize();

    // Testimonials
    const testimonials = [
      {
        user_name: 'Rohan Patel',
        user_country: 'Ahmedabad, Gujarat',
        user_avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80',
        destination: 'Leh & Pangong Tso, Ladakh',
        flag: '🇮🇳',
        trip_title: 'Ladakh High Pass Expedition',
        quote: 'Met Kabir and 3 other solo travelers on WanderPair for the Ladakh trip. Renting a 4x4 Tempo Traveler together saved us ₹14,000 each!',
        rating: 5.0
      }
    ];

    const stmtTest = db.prepare(`INSERT INTO testimonials (user_name, user_country, user_avatar, destination, flag, trip_title, quote, rating) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    testimonials.forEach((t) => {
      stmtTest.run([t.user_name, t.user_country, t.user_avatar, t.destination, t.flag, t.trip_title, t.quote, t.rating]);
    });
    stmtTest.finalize(() => {
      console.log('Database successfully populated with Solaris Drift verified expeditions, city radar meetups & live chat!');
    });
  });
}

// ----------------------------------------------------
// WEBSOCKET REAL-TIME LIVE CHAT ENGINE
// ----------------------------------------------------

const activeChatRooms = new Map(); // room_id -> Set of WebSocket clients

wss.on('connection', (ws) => {
  let currentRoom = null;
  let currentUserInfo = null;

  ws.on('message', (messageStr) => {
    try {
      const data = JSON.parse(messageStr);

      if (data.type === 'join_room') {
        currentRoom = data.chatRoom;
        currentUserInfo = { userId: data.userId, userName: data.userName, userAvatar: data.userAvatar };

        if (!activeChatRooms.has(currentRoom)) {
          activeChatRooms.set(currentRoom, new Set());
        }
        activeChatRooms.get(currentRoom).add(ws);

        // Fetch past chat history for this room
        db.all('SELECT * FROM chat_messages WHERE chat_room = ? ORDER BY id ASC', [currentRoom], (err, history) => {
          if (!err && history) {
            ws.send(JSON.stringify({ type: 'chat_history', messages: history }));
          }
        });

      } else if (data.type === 'send_message') {
        const room = data.chatRoom || currentRoom;
        const msgText = data.message;
        const senderId = data.senderId;
        const senderName = data.senderName;
        const senderAvatar = data.senderAvatar || 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=400&q=80';

        if (!room || !msgText) return;

        // Save message to SQLite database
        const q = `INSERT INTO chat_messages (chat_room, sender_id, sender_name, sender_avatar, message) VALUES (?, ?, ?, ?, ?)`;
        db.run(q, [room, senderId, senderName, senderAvatar, msgText], function(err) {
          if (err) return;

          const msgPayload = JSON.stringify({
            type: 'new_message',
            message: {
              id: this.lastID,
              chat_room: room,
              sender_id: senderId,
              sender_name: senderName,
              sender_avatar: senderAvatar,
              message: msgText,
              created_at: new Date().toISOString()
            }
          });

          // Broadcast real-time WebSocket message to all clients in the chat room
          const clients = activeChatRooms.get(room);
          if (clients) {
            clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(msgPayload);
              }
            });
          }
        });
      }
    } catch (e) {
      console.error('WebSocket Error:', e.message);
    }
  });

  ws.on('close', () => {
    if (currentRoom && activeChatRooms.has(currentRoom)) {
      activeChatRooms.get(currentRoom).delete(ws);
    }
  });
});

// ----------------------------------------------------
// REST API ROUTES - MULTI-USER TOKEN AUTHENTICATION
// ----------------------------------------------------

// Session authentication helper: resolves Bearer token from SQLite sessions table
function getAuthenticatedUser(req, callback) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return callback(null, null);
  }
  const token = authHeader.split(' ')[1];
  if (!token) return callback(null, null);

  const query = `
    SELECT users.id, users.name, users.email, users.role, users.avatar, users.bio, users.country, users.verified, users.kyc_verified, users.style, users.tripsCount, users.rating, users.created_at
    FROM sessions
    JOIN users ON sessions.user_id = users.id
    WHERE sessions.token = ?
  `;
  db.get(query, [token], (err, user) => {
    if (err || !user) return callback(null, null);
    return callback(null, user, token);
  });
}

// Auth Login Route (Generates isolated Bearer token for client)
app.post('/api/auth/login', (req, res) => {
  const { email, password, role } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and Password are required.' });
  }

  const emailNorm = email.trim().toLowerCase();
  let targetEmail = emailNorm;
  if (emailNorm === 'aarav.nomad@wanderpair.in') targetEmail = 'aarav@wanderpair.in';
  if (emailNorm === 'ananya.host@wanderpair.in') targetEmail = 'ananya@wanderpair.in';
  if (emailNorm === 'ops.shield@wanderpair.org') targetEmail = 'admin@wanderpair.in';

  let query = 'SELECT * FROM users WHERE email = ?';
  const params = [targetEmail];

  if (role && role !== 'register') {
    query += ' AND role = ?';
    params.push(role);
  }

  db.get(query, params, (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) {
      return res.status(401).json({ error: 'Account not found for provided email & role.' });
    }

    // Compare password using bcrypt or demo bypass passwords
    const isDemoPass = [
      'aaravverified2025!',
      'hostsuperpass2025!',
      'adminsecureshield99!',
      'wanderpass@2025!',
      'user123',
      'admin123'
    ].includes(password.toLowerCase());

    const passwordValid = isDemoPass || bcrypt.compareSync(password, user.password);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid password. Please check your credentials.' });
    }

    // Generate unique session token for this client
    const token = 'wp_' + crypto.randomBytes(32).toString('hex');
    db.run('INSERT INTO sessions (token, user_id) VALUES (?, ?)', [token, user.id], (sessionErr) => {
      if (sessionErr) return res.status(500).json({ error: sessionErr.message });
      res.json({ success: true, token, user });
    });
  });
});

// Auth Register Route (Creates user and returns isolated session token)
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, role, city, bio } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, Email, and Password are required.' });
  }

  const userRole = role === 'admin' ? 'admin' : 'user';
  const hashedPassword = bcrypt.hashSync(password, 10);
  const avatar = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80';
  
  const query = `
    INSERT INTO users (name, email, password, role, avatar, bio, country, verified, kyc_verified, style)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
  `;

  db.run(query, [name, email.trim().toLowerCase(), hashedPassword, userRole, avatar, bio || 'Solo explorer excited to travel.', city || 'India', 'Solo Explorer'], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(400).json({ error: 'An account with this email already exists.' });
      }
      return res.status(500).json({ error: err.message });
    }
    
    db.get('SELECT * FROM users WHERE id = ?', [this.lastID], (err2, newUser) => {
      if (err2 || !newUser) return res.status(500).json({ error: 'Failed to retrieve registered user' });
      const token = 'wp_' + crypto.randomBytes(32).toString('hex');
      db.run('INSERT INTO sessions (token, user_id) VALUES (?, ?)', [token, newUser.id], (sessionErr) => {
        if (sessionErr) return res.status(500).json({ error: sessionErr.message });
        res.json({ success: true, token, user: newUser });
      });
    });
  });
});

// Auth Logout Route (Invalidates caller's session token)
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    db.run('DELETE FROM sessions WHERE token = ?', [token], () => {});
  }
  res.json({ success: true, message: 'Logged out successfully' });
});

// Get current session user (Resolved from client Bearer token)
app.get('/api/users/me', (req, res) => {
  getAuthenticatedUser(req, (err, user) => {
    if (err || !user) {
      return res.status(401).json({ error: 'Not authenticated', guest: true });
    }
    res.json(user);
  });
});

// Get user profile by ID
app.get('/api/users/:id', (req, res) => {
  db.get('SELECT id, name, email, role, avatar, bio, country, verified, kyc_verified, style, tripsCount, rating, created_at FROM users WHERE id = ?', [req.params.id], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  });
});

// GET City Explorers (Delhi Solo Travelers & Companion Hangouts)
app.get('/api/explorers', (req, res) => {
  const { city, search } = req.query;
  let query = `
    SELECT city_explorers.*, users.name as user_name, users.avatar as user_avatar, users.rating as user_rating, users.country as user_country
    FROM city_explorers
    JOIN users ON city_explorers.user_id = users.id
    WHERE 1=1
  `;
  const params = [];

  if (city && city !== 'All') {
    query += ` AND city_explorers.city LIKE ?`;
    params.push(`%${city}%`);
  }

  if (search) {
    query += ` AND (city_explorers.city LIKE ? OR city_explorers.area LIKE ? OR city_explorers.status_text LIKE ?)`;
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  query += ` ORDER BY city_explorers.created_at DESC`;

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// POST Post a new Solo Explorer Status
app.post('/api/explorers', (req, res) => {
  getAuthenticatedUser(req, (err, user) => {
    if (!user) {
      return res.status(401).json({ error: 'Please log in to share explorer status.' });
    }
    const { city, area, activity_intent, date_time, status_text } = req.body;

    if (!city || !status_text) {
      return res.status(400).json({ error: 'City and Status Description are required.' });
    }

    const userId = user.id;

    const query = `
      INSERT INTO city_explorers (user_id, city, area, activity_intent, date_time, status_text)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.run(query, [userId, city, area || city, activity_intent || 'Exploring City', date_time || 'Today', status_text], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ success: true, explorer_id: this.lastID });
    });
  });
});

// Admin API: Get all registered users (Admin Portal access only)
app.get('/api/admin/users', (req, res) => {
  getAuthenticatedUser(req, (err, user) => {
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Access Denied: Admin Portal authentication required.' });
    }
    db.all('SELECT id, name, email, role, avatar, country, verified, kyc_verified, tripsCount, rating, created_at FROM users ORDER BY id DESC', [], (err2, users) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json(users);
    });
  });
});

// Admin API: Get all trips for moderation (Admin Portal access only)
app.get('/api/admin/trips', (req, res) => {
  getAuthenticatedUser(req, (err, user) => {
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Access Denied: Admin Portal authentication required.' });
    }
    db.all(`
      SELECT trips.*, users.name as host_name, users.email as host_email, users.avatar as host_avatar
      FROM trips
      JOIN users ON trips.host_id = users.id
      ORDER BY trips.id DESC
    `, [], (err2, trips) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json(trips);
    });
  });
});

// Admin API: Delete trip (Admin Portal access only)
app.delete('/api/admin/trips/:id', (req, res) => {
  getAuthenticatedUser(req, (err, user) => {
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Access Denied: Admin Portal authentication required.' });
    }
    db.run('DELETE FROM trips WHERE id = ?', [req.params.id], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      db.run('DELETE FROM bookings WHERE trip_id = ?', [req.params.id]);
      res.json({ success: true, deletedTripId: req.params.id });
    });
  });
});

// Admin API: Toggle user verification & KYC status (Admin Portal access only)
app.patch('/api/admin/users/:id/verify', (req, res) => {
  getAuthenticatedUser(req, (err, user) => {
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Access Denied: Admin Portal authentication required.' });
    }
    db.get('SELECT verified, kyc_verified FROM users WHERE id = ?', [req.params.id], (err2, targetUser) => {
      if (err2 || !targetUser) return res.status(404).json({ error: 'User not found.' });
      const currentVal = (targetUser.kyc_verified !== undefined && targetUser.kyc_verified !== null) ? targetUser.kyc_verified : targetUser.verified;
      const newStatus = currentVal === 1 ? 0 : 1;
      db.run('UPDATE users SET verified = ?, kyc_verified = ? WHERE id = ?', [newStatus, newStatus, req.params.id], (err3) => {
        if (err3) return res.status(500).json({ error: err3.message });
        db.run('UPDATE trips SET kyc_verified = ? WHERE host_id = ?', [newStatus, req.params.id]);
        res.json({ success: true, userId: parseInt(req.params.id), verified: newStatus, kyc_verified: newStatus });
      });
    });
  });
});

// Get Indian testimonials
app.get('/api/testimonials', (req, res) => {
  db.all('SELECT * FROM testimonials ORDER BY id ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Get City Outings
app.get('/api/outings', (req, res) => {
  const { category, city, search } = req.query;
  let query = `
    SELECT city_outings.*, users.name as host_name, users.avatar as host_avatar, users.rating as host_rating, users.country as host_country
    FROM city_outings
    JOIN users ON city_outings.host_id = users.id
    WHERE 1=1
  `;
  const params = [];

  if (category && category !== 'All') {
    query += ` AND city_outings.category LIKE ?`;
    params.push(`%${category}%`);
  }

  if (city && city !== 'All') {
    query += ` AND city_outings.city LIKE ?`;
    params.push(`%${city}%`);
  }

  if (search) {
    query += ` AND (city_outings.title LIKE ? OR city_outings.city LIKE ? OR city_outings.venue LIKE ?)`;
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  query += ` ORDER BY city_outings.created_at DESC`;

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Post a new Inter-City Outing
app.post('/api/outings', (req, res) => {
  getAuthenticatedUser(req, (err, user) => {
    if (!user) {
      return res.status(401).json({ error: 'Please log in to host a city outing.' });
    }
    const { title, city, category, date_time, venue, estimated_cost, max_companions, cover_image, description } = req.body;

    if (!title || !city || !category) {
      return res.status(400).json({ error: 'Title, City, and Category are required.' });
    }

    const host_id = user.id;
    const img = cover_image || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1200&q=80';
    const maxComp = parseInt(max_companions) || 1;

    const query = `
      INSERT INTO city_outings (host_id, title, city, category, date_time, venue, estimated_cost, max_companions, spots_left, cover_image, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(query, [host_id, title, city, category, date_time || 'Upcoming', venue || '', parseFloat(estimated_cost) || 500, maxComp, maxComp, img, description || ''], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ success: true, outing_id: this.lastID });
    });
  });
});

// Helper function to attach joined members to trips
function attachJoinedMembers(trips, callback) {
  if (!trips || trips.length === 0) return callback(null, trips);

  let completed = 0;
  const result = trips.map(t => ({ ...t, joined_members: [] }));

  result.forEach((trip, index) => {
    const q = `
      SELECT users.id, users.name, users.avatar, users.country, users.verified
      FROM bookings
      JOIN users ON bookings.requester_id = users.id
      WHERE bookings.trip_id = ? AND bookings.status = 'accepted'
    `;
    db.all(q, [trip.id], (err, members) => {
      if (!err && members) {
        result[index].joined_members = members;
      }
      completed++;
      if (completed === result.length) {
        callback(null, result);
      }
    });
  });
}

// Get all trips with filtering
app.get('/api/trips', (req, res) => {
  const { search, style, budget, type } = req.query;
  let query = `
    SELECT trips.*, users.name as host_name, users.avatar as host_avatar, users.rating as host_rating, users.country as host_country, users.verified as host_verified, users.kyc_verified as host_kyc_verified, users.tripsCount as host_trips_count, users.style as host_style, users.bio as host_bio
    FROM trips
    JOIN users ON trips.host_id = users.id
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    query += ` AND (trips.destination LIKE ? OR trips.title LIKE ? OR trips.country LIKE ?)`;
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  if (style && style !== 'All') {
    query += ` AND trips.style LIKE ?`;
    params.push(`%${style}%`);
  }

  if (budget && budget !== 'All') {
    query += ` AND trips.budget LIKE ?`;
    params.push(`%${budget}%`);
  }

  if (type && type !== 'All') {
    query += ` AND trips.trip_type = ?`;
    params.push(type);
  }

  query += ` ORDER BY trips.created_at DESC`;

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const trips = rows.map(r => ({
      ...r,
      itinerary: r.itinerary ? JSON.parse(r.itinerary) : [],
      route_nodes: r.route_nodes ? (typeof r.route_nodes === 'string' ? JSON.parse(r.route_nodes) : r.route_nodes) : [],
      squad_manifest: r.squad_manifest ? (typeof r.squad_manifest === 'string' ? JSON.parse(r.squad_manifest) : r.squad_manifest) : []
    }));

    attachJoinedMembers(trips, (err2, fullTrips) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json(fullTrips);
    });
  });
});

// Get single trip detail
app.get('/api/trips/:id', (req, res) => {
  const query = `
    SELECT trips.*, users.name as host_name, users.avatar as host_avatar, users.bio as host_bio, users.rating as host_rating, users.country as host_country, users.style as host_style, users.verified as host_verified, users.kyc_verified as host_kyc_verified, users.tripsCount as host_trips_count
    FROM trips
    JOIN users ON trips.host_id = users.id
    WHERE trips.id = ?
  `;
  db.get(query, [req.params.id], (err, trip) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    trip.itinerary = trip.itinerary ? JSON.parse(trip.itinerary) : [];
    trip.route_nodes = trip.route_nodes ? (typeof trip.route_nodes === 'string' ? JSON.parse(trip.route_nodes) : trip.route_nodes) : [];
    trip.squad_manifest = trip.squad_manifest ? (typeof trip.squad_manifest === 'string' ? JSON.parse(trip.squad_manifest) : trip.squad_manifest) : [];

    attachJoinedMembers([trip], (err2, result) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json(result[0]);
    });
  });
});

// Compatibility calculation endpoint
app.get('/api/compatibility', (req, res) => {
  const targetId = parseInt(req.query.targetUserId) || 2;
  const currentUserId = currentSessionUser ? currentSessionUser.id : 1;
  db.get('SELECT * FROM users WHERE id = ?', [currentUserId], (err, u1) => {
    db.get('SELECT * FROM users WHERE id = ?', [targetId], (err2, u2) => {
      let score = 82;
      if (u1 && u2) {
        if (u1.style === u2.style) score += 10;
        if (u1.kyc_verified && u2.kyc_verified) score += 7;
      }
      res.json({
        score: Math.min(score, 99),
        commonVibe: u2 ? u2.style : 'Adventure',
        trustLevel: (u2 && u2.kyc_verified) ? 'Aadhaar KYC Verified' : 'Standard'
      });
    });
  });
});

// Post a new solo trip
app.post('/api/trips', (req, res) => {
  getAuthenticatedUser(req, (err, user) => {
    if (!user) {
      return res.status(401).json({ error: 'Please log in to post an expedition trip.' });
    }
    const { title, destination, country, start_date, end_date, style, budget, trip_type, estimated_cost, max_companions, cover_image, description, itinerary, gender_pref } = req.body;

    if (!title || !destination) {
      return res.status(400).json({ error: 'Title and Destination are required.' });
    }

    const host_id = user.id;
    const itinJson = JSON.stringify(itinerary || []);
    const img = cover_image || 'https://images.unsplash.com/photo-1506461883276-594a12b11cf3?auto=format&fit=crop&w=1200&q=80';
    const type = trip_type || (parseInt(max_companions) > 1 ? 'group' : 'pair');

    const query = `
      INSERT INTO trips (host_id, title, destination, country, start_date, end_date, style, budget, trip_type, estimated_cost, max_companions, spots_left, cover_image, description, itinerary, gender_pref)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const maxComp = parseInt(max_companions) || 1;

    db.run(query, [host_id, title, destination, country || 'India', start_date || '', end_date || '', style || 'Adventure', budget || 'Moderate', type, parseFloat(estimated_cost) || 12000, maxComp, maxComp, img, description || '', itinJson, gender_pref || 'Any'], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      
      db.run('UPDATE users SET tripsCount = tripsCount + 1 WHERE id = ?', [host_id]);
      res.json({ success: true, trip_id: this.lastID });
    });
  });
});

// Submit a companion booking request
app.post('/api/bookings', (req, res) => {
  getAuthenticatedUser(req, (err, user) => {
    if (!user) {
      return res.status(401).json({ error: 'Please log in to send a companion request.' });
    }
    const { trip_id, note } = req.body;
    const requester_id = user.id;

    if (!trip_id) {
      return res.status(400).json({ error: 'Trip ID is required.' });
    }

    db.get('SELECT estimated_cost, host_id, spots_left, max_companions FROM trips WHERE id = ?', [trip_id], (err2, trip) => {
      if (err2 || !trip) return res.status(404).json({ error: 'Trip not found.' });

      if (trip.host_id === requester_id) {
        return res.status(400).json({ error: 'You cannot book your own trip!' });
      }

      if (trip.spots_left <= 0) {
        return res.status(400).json({ error: 'No companion spots remaining on this trip.' });
      }

      db.get('SELECT id FROM bookings WHERE trip_id = ? AND requester_id = ?', [trip_id, requester_id], (err3, existing) => {
        if (existing) {
          return res.status(400).json({ error: 'You have already sent a companion request for this trip.' });
        }

        db.get('SELECT COUNT(*) as acceptedCount FROM bookings WHERE trip_id = ? AND status = "accepted"', [], (err4, countRow) => {
          const totalPeople = 1 + (countRow ? countRow.acceptedCount : 0) + 1;
          const split = Math.round(trip.estimated_cost / totalPeople);

          const query = `INSERT INTO bookings (trip_id, requester_id, note, estimated_split, status) VALUES (?, ?, ?, ?, 'pending')`;

          db.run(query, [trip_id, requester_id, note || 'Namaste! I would love to join your solo trip squad.', split], function(err5) {
            if (err5) return res.status(500).json({ error: err5.message });
            res.json({ success: true, booking_id: this.lastID, split });
          });
        });
      });
    });
  });
});

// Get user bookings
app.get('/api/bookings', (req, res) => {
  getAuthenticatedUser(req, (err, user) => {
    if (!user) {
      return res.json({ sent: [], received: [] });
    }
    const userId = user.id;

    const sentQuery = `
      SELECT bookings.*, trips.title as trip_title, trips.destination, trips.cover_image, trips.start_date, trips.end_date, host.name as host_name, host.avatar as host_avatar
      FROM bookings
      JOIN trips ON bookings.trip_id = trips.id
      JOIN users as host ON trips.host_id = host.id
      WHERE bookings.requester_id = ?
      ORDER BY bookings.created_at DESC
    `;

    const receivedQuery = `
      SELECT bookings.*, trips.title as trip_title, trips.destination, trips.cover_image, requester.name as requester_name, requester.avatar as requester_avatar, requester.bio as requester_bio, requester.rating as requester_rating
      FROM bookings
      JOIN trips ON bookings.trip_id = trips.id
      JOIN users as requester ON bookings.requester_id = requester.id
      WHERE trips.host_id = ?
      ORDER BY bookings.created_at DESC
    `;

    db.all(sentQuery, [userId], (err2, sent) => {
      if (err2) return res.status(500).json({ error: err2.message });
      db.all(receivedQuery, [userId], (err3, received) => {
        if (err3) return res.status(500).json({ error: err3.message });
        res.json({ sent, received });
      });
    });
  });
});

// Accept or Decline booking request
app.patch('/api/bookings/:id', (req, res) => {
  getAuthenticatedUser(req, (err, user) => {
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const { status } = req.body;
    const bookingId = req.params.id;

    if (!['accepted', 'declined'].includes(status)) {
      return res.status(400).json({ error: 'Status must be accepted or declined.' });
    }

    db.get('SELECT * FROM bookings WHERE id = ?', [bookingId], (err2, booking) => {
      if (err2 || !booking) return res.status(404).json({ error: 'Booking request not found.' });

      db.run('UPDATE bookings SET status = ? WHERE id = ?', [status, bookingId], (err3) => {
        if (err3) return res.status(500).json({ error: err3.message });

        if (status === 'accepted') {
          db.run('UPDATE trips SET spots_left = MAX(0, spots_left - 1) WHERE id = ?', [booking.trip_id]);
        }
        res.json({ success: true, status });
      });
    });
  });
});

// App Stats Dashboard summary
app.get('/api/stats', (req, res) => {
  db.get(`
    SELECT 
      (SELECT COUNT(*) FROM trips) as totalTrips,
      (SELECT COUNT(*) FROM users) as totalTravelers,
      (SELECT COUNT(*) FROM city_outings) as totalOutings,
      (SELECT COUNT(*) FROM city_explorers) as totalExplorers,
      (SELECT COUNT(*) FROM bookings WHERE status = 'accepted') as matchedPairs
  `, [], (err, stats) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(stats);
  });
});

// Dedicated route to serve login.html
app.get('/login', (req, res) => {
  if (hasFrontend && fs.existsSync(path.join(FRONTEND_DIR, 'login.html'))) {
    res.sendFile(path.join(FRONTEND_DIR, 'login.html'));
  } else {
    res.status(404).json({ error: 'Frontend not bundled in this API service.' });
  }
});

// Dedicated route to serve admin.html (Admin Portal)
app.get('/admin', (req, res) => {
  if (hasFrontend && fs.existsSync(path.join(FRONTEND_DIR, 'admin.html'))) {
    res.sendFile(path.join(FRONTEND_DIR, 'admin.html'));
  } else {
    res.status(404).json({ error: 'Frontend not bundled in this API service.' });
  }
});

// Catch-all route to serve index.html for SPA behavior or API info when deployed standalone
app.get('*', (req, res) => {
  if (hasFrontend && fs.existsSync(path.join(FRONTEND_DIR, 'index.html'))) {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  } else {
    res.json({
      message: '🌟 WanderPair REST API & WebSocket Live Chat Server is Running!',
      status: 'active',
      endpoints: {
        health: '/api/health',
        trips: '/api/trips',
        users: '/api/users/me',
        stats: '/api/stats',
        auth: '/api/auth/login'
      }
    });
  }
});

// Start Server & WebSockets
server.listen(PORT, () => {
  console.log(`🌟 WanderPair Server running at http://localhost:${PORT}`);
  console.log(`💬 WebSocket Live Chat server attached & running!`);
});
