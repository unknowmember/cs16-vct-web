const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// --- KẾT NỐI DATABASE (Dùng MongoDB Atlas để không bị xoá khi Deploy) ---
// Thay chuỗi MongoDB của bạn vào đây (hoặc dùng MONGODB_URI trong Environment Variables)
const MONGO_URI = process.env.MONGODB_URI || "mongodb+srv://admin:XxyYZzz1243123@cluster0.brqqwja.mongodb.net/?appName=Cluster0";

mongoose.connect(MONGO_URI)
  .then(() => console.log("MongoDB Connected Successfully!"))
  .catch(err => console.log("MongoDB Connection Error (Running Local Fallback):", err.message));

// Schemas
const UserSchema = new mongoose.Schema({
    id: String, username: String, password: String, role: String, teamId: String, token: String
});
const TeamSchema = new mongoose.Schema({
    id: String, name: String, password: String, members: [String], wins: { type: Number, default: 0 }
});
const MatchSchema = new mongoose.Schema({
    id: String, round: Number,
    teamA: Object, teamB: Object,
    status: String, // WAITING -> PICKING_MAP1 -> PICKING_MAP2 -> READY
    bo3Maps: Array, // [{mapIndex, name, picker, sideA, sideB}]
    scoreA: { type: Number, default: 0 },
    scoreB: { type: Number, default: 0 }
});

const User = mongoose.model('User', UserSchema);
const Team = mongoose.model('Team', TeamSchema);
const Match = mongoose.model('Match', MatchSchema);

const MAP_POOL = ["de_dust2", "de_inferno", "de_nuke", "de_train", "de_aztec", "de_cbble", "de_prodigy"];

// Fast Init Admin
async function initAdmin() {
    const adminExists = await User.findOne({ username: 'admin' });
    if (!adminExists) {
        await User.create({
            id: 'ADMIN_001', username: 'admin',
            password: bcrypt.hashSync('admin123', 10),
            role: 'ADMIN', teamId: null,
            token: crypto.randomBytes(10).toString('hex').toUpperCase()
        });
    }
}
initAdmin();

// --- AUTH APIs ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (await User.findOne({ username })) return res.status(400).json({ error: "Tài khoản đã tồn tại!" });

    const user = await User.create({
        id: Date.now().toString(), username,
        password: await bcrypt.hash(password, 10),
        role: 'USER', teamId: null,
        token: crypto.randomBytes(10).toString('hex').toUpperCase()
    });
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role, token: user.token, teamId: null } });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(400).json({ error: "Sai tài khoản hoặc mật khẩu!" });
    }
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role, token: user.token, teamId: user.teamId } });
});

// --- TEAM APIs ---
app.get('/api/teams', async (req, res) => {
    const teams = await Team.find();
    const users = await User.find();
    const result = teams.map(t => ({
        id: t.id, name: t.name, wins: t.wins,
        members: users.filter(u => u.teamId === t.id).map(u => u.username)
    }));
    res.json(result);
});

app.post('/api/team/create', async (req, res) => {
    const { userId, teamName, teamPassword } = req.body;
    const user = await User.findOne({ id: userId });
    if (!user || user.teamId) return res.status(400).json({ error: "Tài khoản đã có team!" });

    const team = await Team.create({
        id: 'TEAM_' + Date.now(), name: teamName,
        password: await bcrypt.hash(teamPassword, 10),
        members: [user.id]
    });

    user.teamId = team.id;
    await user.save();
    res.json({ success: true, team });
});

app.post('/api/team/join', async (req, res) => {
    const { userId, teamName, teamPassword } = req.body;
    const user = await User.findOne({ id: userId });
    const team = await Team.findOne({ name: teamName });

    if (!user || !team || !(await bcrypt.compare(teamPassword, team.password))) {
        return res.status(400).json({ error: "Thông tin sai!" });
    }

    user.teamId = team.id;
    if (!team.members.includes(user.id)) team.members.push(user.id);
    await user.save();
    await team.save();
    res.json({ success: true, team });
});

// --- DASHBOARD & MATCH LOGIC ---
app.get('/api/dashboard', async (req, res) => {
    const matches = await Match.find();
    const teams = await Team.find();
    res.json({ matches, teams });
});

app.post('/api/admin/setup-bracket', async (req, res) => {
    const { userId, pairings } = req.body;
    const user = await User.findOne({ id: userId });
    if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Chỉ Admin có quyền!' });

    await Match.deleteMany({}); // Reset bracket cu

    const teams = await Team.find();
    const newMatches = [];

    for (let idx = 0; idx < pairings.length; idx++) {
        const pair = pairings[idx];
        const teamA = teams.find(t => t.id === pair.teamAId) || { id: 'BYE_A', name: 'BYE' };
        const teamB = teams.find(t => t.id === pair.teamBId) || { id: 'BYE_B', name: 'BYE' };

        newMatches.push({
            id: `M1_R${idx + 1}`, round: 1,
            teamA, teamB,
            status: 'WAITING',
            bo3Maps: [],
            scoreA: 0, scoreB: 0
        });
    }

    await Match.insertMany(newMatches);
    res.json({ success: true });
});

app.post('/api/admin/start-match', async (req, res) => {
    const { userId, matchId } = req.body;
    const user = await User.findOne({ id: userId });
    if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Chỉ Admin!' });

    const match = await Match.findOne({ id: matchId });
    if (!match) return res.status(404).json({ error: "Trận không tồn tại!" });

    match.status = 'PICKING_MAP1'; // Chuyển sang lượt Team 1 Pick
    await match.save();
    res.json({ success: true, match });
});

// TURN 1: Team A Pick Map 1 & Side
app.post('/api/match/pick-map1', async (req, res) => {
    const { userId, matchId, map1, sideA1 } = req.body;
    const user = await User.findOne({ id: userId });
    const match = await Match.findOne({ id: matchId });

    if (!user || user.teamId !== match.teamA.id) return res.status(403).json({ error: "Chỉ Team A mới được chọn Map 1!" });
    if (match.status !== 'PICKING_MAP1') return res.status(400).json({ error: "Chưa tới lượt chọn Map 1!" });

    match.bo3Maps = [{
        mapIndex: 1, name: map1, picker: match.teamA.name,
        sideA: sideA1, sideB: sideA1 === 'CT' ? 'TERRORIST' : 'CT'
    }];
    match.status = 'PICKING_MAP2'; // Chuyển sang lượt Team B Pick Map 2
    await match.save();
    res.json({ success: true, match });
});

// TURN 2: Team B Pick Map 2 & Side -> Tự động sinh Decider Map 3
app.post('/api/match/pick-map2', async (req, res) => {
    const { userId, matchId, map2, sideB2 } = req.body;
    const user = await User.findOne({ id: userId });
    const match = await Match.findOne({ id: matchId });

    if (!user || user.teamId !== match.teamB.id) return res.status(403).json({ error: "Chỉ Team B mới được chọn Map 2!" });
    if (match.status !== 'PICKING_MAP2') return res.status(400).json({ error: "Chưa tới lượt chọn Map 2!" });

    const map1Name = match.bo3Maps[0].name;
    if (map1Name === map2) return res.status(400).json({ error: "Map 2 không được trùng với Map 1!" });

    // Map 2 Info
    const map2Info = {
        mapIndex: 2, name: map2, picker: match.teamB.name,
        sideA: sideB2 === 'CT' ? 'TERRORIST' : 'CT', sideB: sideB2
    };

    // Tự động random Decider Map 3 từ Map Pool còn lại
    const remainingMaps = MAP_POOL.filter(m => m !== map1Name && m !== map2);
    const deciderMapName = remainingMaps[Math.floor(Math.random() * remainingMaps.length)];
    const sideA3 = Math.random() < 0.5 ? 'CT' : 'TERRORIST';

    const map3Info = {
        mapIndex: 3, name: deciderMapName, picker: "DECIDER (Random)",
        sideA: sideA3, sideB: sideA3 === 'CT' ? 'TERRORIST' : 'CT'
    };

    match.bo3Maps.push(map2Info, map3Info);
    match.status = 'READY'; // Hoàn thành Ban/Pick
    await match.save();
    res.json({ success: true, match });
});

// VERIFY PLAYER FOR CS 1.6 SERVER
app.get('/api/cs16/verify-player', async (req, res) => {
    const { token } = req.query;
    const user = await User.findOne({ token });
    if (!user) return res.json({ success: false, message: "Token không hợp lệ!" });

    const activeMatch = await Match.findOne({
        $or: [{ 'teamA.id': user.teamId }, { 'teamB.id': user.teamId }],
        status: { $in: ['READY', 'PICKING_MAP1', 'PICKING_MAP2'] }
    });

    if (!activeMatch || activeMatch.bo3Maps.length === 0) {
        return res.json({ success: true, username: user.username, role: user.role, isPlaying: false });
    }

    const currentMap = activeMatch.bo3Maps[0];
    const isTeamA = activeMatch.teamA.id === user.teamId;

    res.json({
        success: true, username: user.username, role: user.role, teamId: user.teamId, isPlaying: true,
        matchInfo: {
            matchId: activeMatch.id,
            map: currentMap.name,
            assignedSide: isTeamA ? currentMap.sideA : currentMap.sideB
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`VCT BO3 Server running on port ${PORT}`));