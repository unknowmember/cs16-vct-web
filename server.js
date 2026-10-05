const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Database trong bộ nhớ tạm
const db = {
    users: [],       // { id, username, password, teamId, token }
    teams: [],       // { id, name, password, leaderId, members: [] }
    matches: [],     // { id, teamA, teamB, map, sideA, scoreA, scoreB, status, pickPhase }
    mapPool: ["de_dust2", "de_inferno", "de_nuke", "de_train", "de_aztec", "de_cbble", "de_prodigy"]
};

// --- AUTH APIs ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (db.users.find(u => u.username === username)) {
        return res.status(400).json({ error: "Tài khoản đã tồn tại!" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const token = crypto.randomBytes(10).toString('hex').toUpperCase(); // Mã 20 ký tự
    const user = { id: Date.now().toString(), username, password: hashedPassword, teamId: null, token };
    
    db.users.push(user);
    res.json({ success: true, user: { id: user.id, username: user.username, token: user.token, teamId: null } });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = db.users.find(u => u.username === username);
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(400).json({ error: "Sai tài khoản hoặc mật khẩu!" });
    }
    res.json({ success: true, user: { id: user.id, username: user.username, token: user.token, teamId: user.teamId } });
});

// --- TEAM APIs ---
app.post('/api/team/create', async (req, res) => {
    const { userId, teamName, teamPassword } = req.body;
    const user = db.users.find(u => u.id === userId);
    if (!user) return res.status(400).json({ error: "User không tồn tại!" });
    if (user.teamId) return res.status(400).json({ error: "Bạn đã ở trong team khác!" });

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
    const team = db.teams.find(t => t.name === teamName);

    if (!team) return res.status(400).json({ error: "Không tìm thấy Team!" });
    if (!(await bcrypt.compare(teamPassword, team.password))) {
        return res.status(400).json({ error: "Sai mật khẩu Team!" });
    }

    user.teamId = team.id;
    if (!team.members.includes(user.id)) team.members.push(user.id);
    res.json({ success: true, team });
});

// --- TOURNAMENT & MATCH APIs ---
app.get('/api/dashboard', (req, res) => {
    res.json({
        teams: db.teams.map(t => ({ id: t.id, name: t.name, memberCount: t.members.length })),
        matches: db.matches
    });
});

app.post('/api/admin/start-tournament', (req, res) => {
    if (db.teams.length < 2) return res.status(400).json({ error: "Cần tối thiểu 2 Team!" });

    db.matches = [];
    for (let i = 0; i < db.teams.length; i += 2) {
        if (i + 1 < db.teams.length) {
            db.matches.push({
                id: 'MATCH_' + (Math.floor(i/2) + 1),
                teamA: db.teams[i],
                teamB: db.teams[i+1],
                bannedMaps: [],
                pickedMapA: null,
                pickedMapB: null,
                deciderMap: null,
                sideA: 'CT',
                status: 'PICKING', // PICKING -> READY -> IN_PROGRESS -> FINISHED
                scoreA: 0,
                scoreB: 0
            });
        }
    }
    res.json({ success: true, matches: db.matches });
});

// Pick/Ban Map Phase
app.post('/api/match/pickban', (req, res) => {
    const { matchId, action, mapName, side } = req.body; // action: ban, pick, side
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

    // Tự động chọn Decider Map khi đã cấm/chọn gần hết
    const remaining = db.mapPool.filter(m => !match.bannedMaps.includes(m) && m !== match.pickedMapA && m !== match.pickedMapB);
    if (remaining.length === 1) {
        match.deciderMap = remaining[0];
        match.status = 'READY';
    }

    res.json({ success: true, match });
});

// --- CS 1.6 VERIFICATION API ---
// CS 1.6 gọi endpoint này khi người chơi gõ: say /login <20_CHAR_TOKEN>
app.get('/api/cs16/verify-player', (req, res) => {
    const { token } = req.query;
    const user = db.users.find(u => u.token === token);
    if (!user) return res.json({ success: false, message: "Mã Token không hợp lệ!" });

    const team = db.teams.find(t => t.id === user.teamId);
    const activeMatch = db.matches.find(m => (m.teamA.id === user.teamId || m.teamB.id === user.teamId) && (m.status === 'READY' || m.status === 'IN_PROGRESS'));

    res.json({
        success: true,
        username: user.username,
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