const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Database trong bộ nhớ RAM
const db = {
    users: [],       // { id, username, password, role, teamId, token }
    teams: [],       // { id, name, password, members: [] }
    matches: [],     // { id, teamA, teamB, bannedMaps: [], pickedMapA, pickedMapB, deciderMap, sideA, status, scoreA, scoreB }
    mapPool: ["de_dust2", "de_inferno", "de_nuke", "de_train", "de_aztec", "de_cbble", "de_prodigy"]
};

// Tạo sẵn tài khoản Admin mặc định: admin / admin123
const adminPasswordHash = bcrypt.hashSync('Hoangh@171112', 10);
db.users.push({
    id: 'ADMIN_001',
    username: 'admin',
    password: adminPasswordHash,
    role: 'ADMIN',
    teamId: null,
    token: crypto.randomBytes(10).toString('hex').toUpperCase()
});

function generateToken() {
    return crypto.randomBytes(10).toString('hex').toUpperCase();
}

// --- AUTH APIs ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Thiếu thông tin đăng ký!" });
    if (db.users.find(u => u.username === username)) {
        return res.status(400).json({ error: "Tài khoản đã tồn tại!" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = {
        id: Date.now().toString(),
        username,
        password: hashedPassword,
        role: 'USER',
        teamId: null,
        token: generateToken()
    };
    
    db.users.push(user);
    res.json({
        success: true,
        user: { id: user.id, username: user.username, role: user.role, token: user.token, teamId: null }
    });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = db.users.find(u => u.username === username);
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(400).json({ error: "Sai tài khoản hoặc mật khẩu!" });
    }
    res.json({
        success: true,
        user: { id: user.id, username: user.username, role: user.role || 'USER', token: user.token, teamId: user.teamId }
    });
});

// --- TEAM APIs ---
app.post('/api/team/create', async (req, res) => {
    const { userId, teamName, teamPassword } = req.body;
    const user = db.users.find(u => u.id === userId);
    if (!user) return res.status(400).json({ error: "User không tồn tại!" });
    if (user.teamId) return res.status(400).json({ error: "Bạn đã thuộc một team khác!" });
    if (!teamName || !teamPassword) return res.status(400).json({ error: "Nhập thiếu tên hoặc mật khẩu Team!" });

    const hashedPassword = await bcrypt.hash(teamPassword, 10);
    const team = {
        id: 'TEAM_' + Date.now(),
        name: teamName,
        password: hashedPassword,
        members: [user.id]
    };

    db.teams.push(team);
    user.teamId = team.id;
    res.json({ success: true, team });
});

app.post('/api/team/join', async (req, res) => {
    const { userId, teamName, teamPassword } = req.body;
    const user = db.users.find(u => u.id === userId);
    if (!user) return res.status(400).json({ error: "User không tồn tại!" });
    
    const team = db.teams.find(t => t.name === teamName);
    if (!team) return res.status(400).json({ error: "Không tìm thấy Team!" });
    if (!(await bcrypt.compare(teamPassword, team.password))) {
        return res.status(400).json({ error: "Sai mật khẩu Team!" });
    }

    user.teamId = team.id;
    if (!team.members.includes(user.id)) team.members.push(user.id);
    res.json({ success: true, team });
});

// --- DASHBOARD & ADMIN TOURNAMENT APIs ---
app.get('/api/dashboard', (req, res) => {
    res.json({
        teams: db.teams.map(t => ({ id: t.id, name: t.name, memberCount: t.members.length })),
        matches: db.matches
    });
});

app.post('/api/admin/start-tournament', (req, res) => {
    const { userId } = req.body;
    const user = db.users.find(u => u.id === userId);
    if (!user || user.role !== 'ADMIN') {
        return res.status(403).json({ error: "Chỉ ADMIN mới có quyền khởi tạo giải đấu!" });
    }

    if (db.teams.length < 2) return res.status(400).json({ error: "Cần tối thiểu 2 Team để bắt đầu!" });

    db.matches = [];
    for (let i = 0; i < db.teams.length; i += 2) {
        if (i + 1 < db.teams.length) {
            db.matches.push({
                id: 'MATCH_' + (Math.floor(i / 2) + 1),
                teamA: db.teams[i],
                teamB: db.teams[i + 1],
                bannedMaps: [],
                pickedMapA: null,
                pickedMapB: null,
                deciderMap: null,
                sideA: 'CT',
                status: 'PICKING',
                scoreA: 0,
                scoreB: 0
            });
        }
    }
    res.json({ success: true, matches: db.matches });
});

// Pick / Ban Map API
app.post('/api/match/pickban', (req, res) => {
    const { matchId, action, mapName, side } = req.body;
    const match = db.matches.find(m => m.id === matchId);
    if (!match) return res.status(404).json({ error: "Trận đấu không tồn tại!" });

    if (action === 'ban' && !match.bannedMaps.includes(mapName)) {
        match.bannedMaps.push(mapName);
    } else if (action === 'pickA') {
        match.pickedMapA = mapName;
    } else if (action === 'pickB') {
        match.pickedMapB = mapName;
    } else if (action === 'sideA') {
        match.sideA = side;
    }

    const remaining = db.mapPool.filter(m => !match.bannedMaps.includes(m) && m !== match.pickedMapA && m !== match.pickedMapB);
    if (remaining.length === 1) {
        match.deciderMap = remaining[0];
        match.status = 'READY';
    }

    res.json({ success: true, match });
});

// --- CS 1.6 VERIFICATION API ---
// Plugin CS 1.6 gọi endpoint này: /api/cs16/verify-player?token=<MÃ_20_KÝ_TỰ>
app.get('/api/cs16/verify-player', (req, res) => {
    const { token } = req.query;
    const user = db.users.find(u => u.token === token);
    if (!user) return res.json({ success: false, message: "Mã Token không hợp lệ!" });

    const team = db.teams.find(t => t.id === user.teamId);
    const activeMatch = db.matches.find(m => 
        (m.teamA.id === user.teamId || m.teamB.id === user.teamId) && 
        (m.status === 'READY' || m.status === 'PICKING')
    );

    res.json({
        success: true,
        username: user.username,
        role: user.role || 'USER',
        teamName: team ? team.name : "Chưa có team",
        isPlaying: !!activeMatch,
        matchInfo: activeMatch ? {
            matchId: activeMatch.id,
            map: activeMatch.pickedMapA || activeMatch.deciderMap || "de_dust2",
            isTeamA: activeMatch.teamA.id === user.teamId,
            sideA: activeMatch.sideA
        } : null
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`VCT Server running on port ${PORT}`));