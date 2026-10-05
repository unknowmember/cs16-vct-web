const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const DB_FILE = path.join(__dirname, 'db.json');

function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialDB = { users: [], teams: [], matches: [] };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialDB, null, 2));
        return initialDB;
    }
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
        return { users: [], teams: [], matches: [] };
    }
}

function saveDB(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let db = loadDB();

// Khởi tạo Admin mặc định (admin / admin123)
if (!db.users.find(u => u.username === 'admin')) {
    db.users.push({
        id: 'ADMIN_001',
        username: 'admin',
        password: bcrypt.hashSync('Hoangh@171112', 10),
        role: 'ADMIN',
        teamId: null,
        token: crypto.randomBytes(10).toString('hex').toUpperCase()
    });
    saveDB(db);
}

function generateToken() {
    return crypto.randomBytes(10).toString('hex').toUpperCase();
}

// --- AUTH APIs ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Thiếu thông tin!" });
    if (db.users.find(u => u.username === username)) {
        return res.status(400).json({ error: "Tài khoản đã tồn tại!" });
    }

    const user = {
        id: Date.now().toString(),
        username,
        password: await bcrypt.hash(password, 10),
        role: 'USER',
        teamId: null,
        token: generateToken()
    };
    
    db.users.push(user);
    saveDB(db);
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role, token: user.token, teamId: null } });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = db.users.find(u => u.username === username);
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(400).json({ error: "Sai tài khoản hoặc mật khẩu!" });
    }
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role || 'USER', token: user.token, teamId: user.teamId } });
});

// --- TEAM APIs ---
app.get('/api/teams', (req, res) => {
    const fullTeams = db.teams.map(t => ({
        id: t.id,
        name: t.name,
        members: db.users.filter(u => u.teamId === t.id).map(u => u.username),
        wins: t.wins || 0,
        isEliminated: t.isEliminated || false
    }));
    res.json(fullTeams);
});

app.post('/api/team/create', async (req, res) => {
    const { userId, teamName, teamPassword } = req.body;
    const user = db.users.find(u => u.id === userId);
    if (!user || user.teamId) return res.status(400).json({ error: "Tài khoản đã thuộc team khác!" });

    const team = {
        id: 'TEAM_' + Date.now(),
        name: teamName,
        password: await bcrypt.hash(teamPassword, 10),
        members: [user.id],
        wins: 0,
        isEliminated: false
    };

    db.teams.push(team);
    user.teamId = team.id;
    saveDB(db);
    res.json({ success: true, team });
});

app.post('/api/team/join', async (req, res) => {
    const { userId, teamName, teamPassword } = req.body;
    const user = db.users.find(u => u.id === userId);
    const team = db.teams.find(t => t.name === teamName);
    if (!user || !team || !(await bcrypt.compare(teamPassword, team.password))) {
        return res.status(400).json({ error: "Thông tin gia nhập không đúng!" });
    }

    user.teamId = team.id;
    if (!team.members.includes(user.id)) team.members.push(user.id);
    saveDB(db);
    res.json({ success: true, team });
});

app.post('/api/admin/delete-team', (req, res) => {
    const { userId, teamId } = req.body;
    const user = db.users.find(u => u.id === userId);
    if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Chỉ Admin mới có quyền!' });

    db.teams = db.teams.filter(t => t.id !== teamId);
    db.users.forEach(u => { if (u.teamId === teamId) u.teamId = null; });
    saveDB(db);

    res.json({ success: true, message: 'Đã giải tán team thành công!' });
});

// --- DASHBOARD & BRACKET SETUP APIs ---
app.get('/api/dashboard', (req, res) => {
    res.json({
        teams: db.teams.map(t => ({ id: t.id, name: t.name, memberCount: t.members.length })),
        matches: db.matches
    });
});

app.post('/api/admin/setup-bracket', (req, res) => {
    const { userId, pairings } = req.body;
    const user = db.users.find(u => u.id === userId);
    if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Chỉ Admin mới có quyền!' });

    db.matches = pairings.map((pair, idx) => {
        const teamA = db.teams.find(t => t.id === pair.teamAId) || { id: 'BYE_A', name: 'Miễn đấu (BYE)' };
        const teamB = db.teams.find(t => t.id === pair.teamBId) || { id: 'BYE_B', name: 'Miễn đấu (BYE)' };

        return {
            id: `M1_R${idx + 1}`,
            round: 1,
            teamA,
            teamB,
            status: 'WAITING', // WAITING -> PICKING -> READY -> FINISHED
            currentMapIndex: 0,
            bo3Maps: [], // Danh sách 3 maps BO3
            scoreA: 0,
            scoreB: 0
        };
    });

    saveDB(db);
    res.json({ success: true, matches: db.matches });
});

app.post('/api/admin/start-match', (req, res) => {
    const { userId, matchId } = req.body;
    const user = db.users.find(u => u.id === userId);
    if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Chỉ Admin mới có quyền!' });

    const match = db.matches.find(m => m.id === matchId);
    if (!match) return res.status(404).json({ error: "Không tìm thấy trận!" });

    match.status = 'PICKING';
    saveDB(db);
    res.json({ success: true, match });
});

// Chốt Ban/Pick Map BO3
app.post('/api/match/setup-bo3', (req, res) => {
    const { userId, matchId, map1, sideA_map1, map2, sideB_map2, map3 } = req.body;

    const user = db.users.find(u => u.id === userId);
    const match = db.matches.find(m => m.id === matchId);

    if (!user || !match) return res.status(404).json({ error: "Dữ liệu không hợp lệ!" });
    if (user.teamId !== match.teamA.id && user.teamId !== match.teamB.id) {
        return res.status(403).json({ error: "Bạn không thuộc 2 đội trong trận này!" });
    }

    if (map1 === map2 || map2 === map3 || map1 === map3) {
        return res.status(400).json({ error: "3 Map thi đấu BO3 phải khác nhau!" });
    }

    // Map 1: Team A Pick -> Team A chọn side
    const sideA1 = sideA_map1 || 'CT';
    
    // Map 2: Team B Pick -> Team B chọn side (Suy ra Side Team A)
    const sideA2 = (sideB_map2 === 'CT') ? 'TERRORIST' : 'CT';

    // Map 3: Decider -> Random Phe 50/50 cho Team A
    const sideA3 = Math.random() < 0.5 ? 'CT' : 'TERRORIST';

    match.bo3Maps = [
        { mapIndex: 1, name: map1, picker: match.teamA.name, sideA: sideA1, sideB: sideA1 === 'CT' ? 'TERRORIST' : 'CT' },
        { mapIndex: 2, name: map2, picker: match.teamB.name, sideA: sideA2, sideB: sideB_map2 },
        { mapIndex: 3, name: map3, picker: "DECIDER (Random Side)", sideA: sideA3, sideB: sideA3 === 'CT' ? 'TERRORIST' : 'CT' }
    ];

    match.status = 'READY';
    match.currentMapIndex = 0; // Bắt đầu ở Map 1
    saveDB(db);

    res.json({ success: true, match });
});

// --- CS 1.6 VERIFICATION API ---
app.get('/api/cs16/verify-player', (req, res) => {
    const { token } = req.query;
    const user = db.users.find(u => u.token === token);
    if (!user) return res.json({ success: false, message: "Mã Token không hợp lệ!" });

    const team = db.teams.find(t => t.id === user.teamId);
    const activeMatch = db.matches.find(m => 
        (m.teamA.id === user.teamId || m.teamB.id === user.teamId) && 
        (m.status === 'READY' || m.status === 'PICKING')
    );

    if (!activeMatch || activeMatch.bo3Maps.length === 0) {
        return res.json({
            success: true,
            username: user.username,
            role: user.role || 'USER',
            teamName: team ? team.name : "Chưa có team",
            isPlaying: false
        });
    }

    const currentMapInfo = activeMatch.bo3Maps[activeMatch.currentMapIndex] || activeMatch.bo3Maps[0];
    const isTeamA = activeMatch.teamA.id === user.teamId;

    // Xác định chính xác Phe của Player ở Map hiện tại
    const playerSide = isTeamA ? currentMapInfo.sideA : currentMapInfo.sideB;

    const teamAMembers = db.users.filter(u => u.teamId === activeMatch.teamA.id).map(u => u.username);
    const teamBMembers = db.users.filter(u => u.teamId === activeMatch.teamB.id).map(u => u.username);

    res.json({
        success: true,
        username: user.username,
        role: user.role || 'USER',
        teamId: user.teamId,
        teamName: team ? team.name : "Chưa có team",
        isPlaying: true,
        matchInfo: {
            matchId: activeMatch.id,
            currentMapNumber: activeMatch.currentMapIndex + 1,
            map: currentMapInfo.name,
            picker: currentMapInfo.picker,
            assignedSide: playerSide, // 'CT' hoặc 'TERRORIST'
            teamA: { id: activeMatch.teamA.id, name: activeMatch.teamA.name, members: teamAMembers, side: currentMapInfo.sideA },
            teamB: { id: activeMatch.teamB.id, name: activeMatch.teamB.name, members: teamBMembers, side: currentMapInfo.sideB }
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`VCT BO3 Server running on port ${PORT}`));