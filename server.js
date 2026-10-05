const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(cors());

// Phục vụ file tĩnh
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

// KẾT NỐI MONGODB
const MONGO_URI = process.env.MONGODB_URI || "mongodb+srv://admin:XxyYZzz1243123@cluster0.brqqwja.mongodb.net/?appName=Cluster0";

mongoose.connect(MONGO_URI)
  .then(() => console.log("MongoDB Connected Successfully!"))
  .catch(err => console.log("MongoDB Connection Error:", err.message));

// SCHEMAS
const UserSchema = new mongoose.Schema({
    id: String, username: String, password: String, role: String, teamId: String, token: String
});
const TeamSchema = new mongoose.Schema({
    id: String, name: String, password: String, leaderId: String, members: [String], wins: { type: Number, default: 0 }
});
const MatchSchema = new mongoose.Schema({
    id: String, round: Number,
    teamA: Object, teamB: Object,
    status: String, // WAITING, PICKING_MAP1, PICKING_MAP2, READY, PLAYING, FINISHED
    bo3Maps: Array,
    scoreA: { type: Number, default: 0 },
    scoreB: { type: Number, default: 0 },
    // CÁC TRƯỜNG MỚI PHỤC VỤ LIVESETUP / BROADCAST
    isLive: { type: Boolean, default: false },
    streamUrl: { type: String, default: "" }, // Đường dẫn YouTube / Twitch / HLS / Embed ID
    currentMapIndex: { type: Number, default: 1 },
    roundScoreA: { type: Number, default: 0 }, // Tỉ số Round lẻ trong Map hiện tại
    roundScoreB: { type: Number, default: 0 }
});

const User = mongoose.model('User', UserSchema);
const Team = mongoose.model('Team', TeamSchema);
const Match = mongoose.model('Match', MatchSchema);

const MAP_POOL = ["de_dust2", "de_inferno", "de_nuke", "de_train", "de_aztec", "de_cbble", "de_prodigy"];

async function initAdmin() {
    try {
        const adminExists = await User.findOne({ username: 'admin' });
        if (!adminExists) {
            await User.create({
                id: 'ADMIN_001', username: 'admin',
                password: bcrypt.hashSync('Hoangh@171112', 10),
                role: 'ADMIN', teamId: null,
                token: crypto.randomBytes(10).toString('hex').toUpperCase()
            });
            console.log("Khởi tạo Admin mặc định thành công!");
        }
    } catch (err) {
        console.error("Lỗi khởi tạo Admin:", err.message);
    }
}
initAdmin();

// TỰ ĐỘNG ĐẨY ĐỘI THẮNG VÒNG 1 VÀO TRẬN CHUNG KẾT (M3 - ROUND 2)
async function checkAndAdvanceBracket() {
    try {
        const r1Matches = await Match.find({ round: 1 }).sort({ id: 1 });
        if (r1Matches.length === 0) return;

        const getWinner = (m) => {
            if (!m || m.status !== 'FINISHED') return { id: 'TBD', name: 'TBD (Chờ Đội Thắng)' };
            if (m.scoreA > m.scoreB) return m.teamA;
            if (m.scoreB > m.scoreA) return m.teamB;
            return { id: 'TBD', name: 'TBD' };
        };

        const winnerM1 = getWinner(r1Matches[0]);
        const winnerM2 = r1Matches.length > 1 ? getWinner(r1Matches[1]) : { id: 'BYE', name: 'BYE' };

        let finalMatch = await Match.findOne({ id: 'M3', round: 2 });

        if (!finalMatch) {
            finalMatch = new Match({
                id: 'M3', round: 2,
                teamA: winnerM1, teamB: winnerM2,
                status: 'WAITING', bo3Maps: [],
                scoreA: 0, scoreB: 0
            });
        } else {
            finalMatch.teamA = winnerM1;
            finalMatch.teamB = winnerM2;
        }

        if (winnerM1.id !== 'TBD' && winnerM2.id !== 'TBD' && finalMatch.status === 'WAITING') {
            finalMatch.status = 'WAITING';
        }

        await finalMatch.save();
    } catch (err) {
        console.error("Lỗi tự động đẩy nhánh đấu:", err);
    }
}

// 1. AUTHENTICATION
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

// 2. TEAMS
app.get('/api/teams', async (req, res) => {
    const teams = await Team.find();
    const users = await User.find();
    const result = teams.map(t => ({
        id: t.id, name: t.name, leaderId: t.leaderId, wins: t.wins,
        members: users.filter(u => u.teamId === t.id).map(u => ({ id: u.id, username: u.username, isLeader: u.id === t.leaderId }))
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
        leaderId: user.id,
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

// 3. ADMIN: XÓA ĐỘI & AUTO WIN
app.post('/api/admin/delete-team', async (req, res) => {
    try {
        const { userId, teamId } = req.body;
        const user = await User.findOne({ id: userId });
        if (!user || user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Chỉ Admin mới có quyền xóa đội!' });
        }

        await Team.deleteOne({ id: teamId });
        await User.updateMany({ teamId: teamId }, { $set: { teamId: null } });

        const affectedMatches = await Match.find({
            $or: [{ 'teamA.id': teamId }, { 'teamB.id': teamId }]
        });

        for (let match of affectedMatches) {
            let isTeamA = match.teamA && match.teamA.id === teamId;
            let isTeamB = match.teamB && match.teamB.id === teamId;

            if (isTeamA) {
                match.teamA = { id: 'BYE', name: 'BYE (Đã xóa)' };
                if (match.teamB && match.teamB.id !== 'BYE' && match.teamB.id !== 'BYE_B') {
                    match.status = 'FINISHED';
                    match.scoreA = 0;
                    match.scoreB = 2;
                }
            }

            if (isTeamB) {
                match.teamB = { id: 'BYE', name: 'BYE (Đã xóa)' };
                if (match.teamA && match.teamA.id !== 'BYE' && match.teamA.id !== 'BYE_A') {
                    match.status = 'FINISHED';
                    match.scoreA = 2;
                    match.scoreB = 0;
                }
            }

            await match.save();
        }

        await checkAndAdvanceBracket();
        res.json({ success: true, message: "Xóa đội thành công và đã cập nhật nhánh đấu!" });
    } catch (err) {
        console.error("Lỗi xóa đội:", err);
        res.status(500).json({ error: "Lỗi server khi xóa đội!" });
    }
});

// 4. MATCH & DASHBOARD
app.get('/api/dashboard', async (req, res) => {
    await checkAndAdvanceBracket();
    const matches = await Match.find();
    const teams = await Team.find();
    const liveMatch = matches.find(m => m.isLive) || null;
    res.json({ matches, teams, liveMatch });
});

app.post('/api/admin/setup-bracket', async (req, res) => {
    const { userId, pairings } = req.body;
    const user = await User.findOne({ id: userId });
    if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Chỉ Admin có quyền!' });

    await Match.deleteMany({});
    const teams = await Team.find();
    const newMatches = [];

    for (let idx = 0; idx < pairings.length; idx++) {
        const pair = pairings[idx];
        const teamA = teams.find(t => t.id === pair.teamAId) || { id: 'BYE_A', name: 'BYE' };
        const teamB = teams.find(t => t.id === pair.teamBId) || { id: 'BYE_B', name: 'BYE' };

        let status = 'WAITING';
        let scoreA = 0;
        let scoreB = 0;

        if (teamA.id.startsWith('BYE') && !teamB.id.startsWith('BYE')) {
            status = 'FINISHED';
            scoreB = 2;
        } else if (!teamA.id.startsWith('BYE') && teamB.id.startsWith('BYE')) {
            status = 'FINISHED';
            scoreA = 2;
        }

        newMatches.push({
            id: `M${idx + 1}`, round: 1,
            teamA, teamB, status,
            bo3Maps: [], scoreA, scoreB,
            isLive: false, streamUrl: "", currentMapIndex: 1, roundScoreA: 0, roundScoreB: 0
        });
    }

    newMatches.push({
        id: 'M3', round: 2,
        teamA: { id: 'TBD', name: 'TBD (Chờ Đội Thắng)' },
        teamB: { id: 'TBD', name: 'TBD (Chờ Đội Thắng)' },
        status: 'WAITING',
        bo3Maps: [], scoreA: 0, scoreB: 0,
        isLive: false, streamUrl: "", currentMapIndex: 1, roundScoreA: 0, roundScoreB: 0
    });

    await Match.insertMany(newMatches);
    await checkAndAdvanceBracket();

    res.json({ success: true });
});

app.post('/api/admin/start-match', async (req, res) => {
    const { userId, matchId } = req.body;
    const user = await User.findOne({ id: userId });
    if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Chỉ Admin!' });

    const match = await Match.findOne({ id: matchId });
    if (!match) return res.status(404).json({ error: "Trận không tồn tại!" });

    match.status = 'PICKING_MAP1';
    await match.save();
    res.json({ success: true, match });
});

// CẤU HÌNH LIVESTREAM VÀ TỈ SỐ LIVE (ADMIN)
app.post('/api/admin/update-stream', async (req, res) => {
    try {
        const { userId, matchId, isLive, streamUrl, roundScoreA, roundScoreB, currentMapIndex } = req.body;
        const user = await User.findOne({ id: userId });
        if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Chỉ Admin!' });

        if (isLive) {
            // Tắt Live của tất cả các trận khác
            await Match.updateMany({ id: { $ne: matchId } }, { $set: { isLive: false } });
        }

        const match = await Match.findOne({ id: matchId });
        if (!match) return res.status(404).json({ error: "Không tìm thấy trận đấu!" });

        match.isLive = !!isLive;
        if (streamUrl !== undefined) match.streamUrl = streamUrl;
        if (roundScoreA !== undefined) match.roundScoreA = Number(roundScoreA);
        if (roundScoreB !== undefined) match.roundScoreB = Number(roundScoreB);
        if (currentMapIndex !== undefined) match.currentMapIndex = Number(currentMapIndex);

        if (isLive && match.status === 'READY') {
            match.status = 'PLAYING';
        }

        await match.save();
        res.json({ success: true, match });
    } catch (err) {
        res.status(500).json({ error: "Lỗi cập nhật Live Stream!" });
    }
});

// 5. PICK / BAN MAP LOGIC
app.post('/api/match/pick-map1', async (req, res) => {
    const { userId, matchId, map1, sideA1 } = req.body;
    const user = await User.findOne({ id: userId });
    const match = await Match.findOne({ id: matchId });
    const teamA = await Team.findOne({ id: match?.teamA?.id });

    if (!user || !teamA) return res.status(403).json({ error: "Lỗi người dùng hoặc không tìm thấy Team A!" });
    if (teamA.leaderId !== user.id) return res.status(403).json({ error: "Chỉ ĐỘI TRƯỞNG của Team A mới có quyền Pick Map!" });
    if (match.status !== 'PICKING_MAP1') return res.status(400).json({ error: "Chưa tới lượt chọn Map 1!" });

    match.bo3Maps = [{
        mapIndex: 1, name: map1, picker: match.teamA.name,
        sideA: sideA1, sideB: sideA1 === 'CT' ? 'TERRORIST' : 'CT'
    }];
    match.status = 'PICKING_MAP2';
    await match.save();
    res.json({ success: true, match });
});

app.post('/api/match/pick-map2', async (req, res) => {
    const { userId, matchId, map2, sideB2 } = req.body;
    const user = await User.findOne({ id: userId });
    const match = await Match.findOne({ id: matchId });
    const teamB = await Team.findOne({ id: match?.teamB?.id });

    if (!user || !teamB) return res.status(403).json({ error: "Lỗi người dùng hoặc không tìm thấy Team B!" });
    if (teamB.leaderId !== user.id) return res.status(403).json({ error: "Chỉ ĐỘI TRƯỞNG của Team B mới có quyền Pick Map!" });
    if (match.status !== 'PICKING_MAP2') return res.status(400).json({ error: "Chưa tới lượt chọn Map 2!" });

    const map1Name = match.bo3Maps[0]?.name;
    if (map1Name === map2) return res.status(400).json({ error: "Map 2 không được trùng với Map 1!" });

    const map2Info = {
        mapIndex: 2, name: map2, picker: match.teamB.name,
        sideA: sideB2 === 'CT' ? 'TERRORIST' : 'CT', sideB: sideB2
    };

    const remainingMaps = MAP_POOL.filter(m => m !== map1Name && m !== map2);
    const deciderMapName = remainingMaps[Math.floor(Math.random() * remainingMaps.length)];
    const sideA3 = Math.random() < 0.5 ? 'CT' : 'TERRORIST';

    const map3Info = {
        mapIndex: 3, name: deciderMapName, picker: "DECIDER (Random)",
        sideA: sideA3, sideB: sideA3 === 'CT' ? 'TERRORIST' : 'CT'
    };

    match.bo3Maps.push(map2Info, map3Info);
    match.status = 'READY';
    await match.save();
    res.json({ success: true, match });
});

// 6. API CS 1.6 & LIVE STATS
app.post('/api/cs/login', async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ error: "Thiếu Token!" });

        const user = await User.findOne({ token: token.trim().toUpperCase() });
        if (!user) return res.status(404).json({ error: "Token không tồn tại!" });

        const team = user.teamId ? await Team.findOne({ id: user.teamId }) : null;
        const activeMatch = team ? await Match.findOne({
            $or: [{ 'teamA.id': team.id }, { 'teamB.id': team.id }],
            status: { $in: ['READY', 'PLAYING'] }
        }) : null;

        let playerSideInMatch = null;
        if (activeMatch && team) {
            playerSideInMatch = activeMatch.teamA.id === team.id ? 'TEAM_A' : 'TEAM_B';
        }

        res.json({
            success: true,
            player: { id: user.id, username: user.username, role: user.role, teamId: user.teamId, teamName: team ? team.name : null, isLeader: team ? team.leaderId === user.id : false, side: playerSideInMatch },
            activeMatch: activeMatch ? { matchId: activeMatch.id, status: activeMatch.status } : null
        });
    } catch (err) {
        res.status(500).json({ error: "Lỗi kết nối CS Login!" });
    }
});

app.get('/api/cs/live-match', async (req, res) => {
    try {
        const match = await Match.findOne({ $or: [{ isLive: true }, { status: 'PLAYING' }] });
        if (!match) return res.status(404).json({ message: "Không có trận đấu nào đang diễn ra!" });

        res.json({ success: true, match });
    } catch (err) {
        res.status(500).json({ error: "Lỗi lấy thông tin trận đấu CS 1.6!" });
    }
});

app.post('/api/cs/update-live-score', async (req, res) => {
    try {
        const { matchId, roundScoreA, roundScoreB, currentMapIndex } = req.body;
        const match = await Match.findOne({ id: matchId });
        if (!match) return res.status(404).json({ error: "Không tìm thấy trận đấu!" });

        if (roundScoreA !== undefined) match.roundScoreA = roundScoreA;
        if (roundScoreB !== undefined) match.roundScoreB = roundScoreB;
        if (currentMapIndex !== undefined) match.currentMapIndex = currentMapIndex;

        await match.save();
        res.json({ success: true, match });
    } catch (err) {
        res.status(500).json({ error: "Lỗi cập nhật Live Score!" });
    }
});

app.post('/api/cs/update-map-result', async (req, res) => {
    try {
        const { matchId, mapName, winnerTeamId, scoreA, scoreB } = req.body;
        const match = await Match.findOne({ id: matchId });
        if (!match) return res.status(404).json({ error: "Không tìm thấy trận đấu!" });

        match.status = 'PLAYING';
        if (winnerTeamId === match.teamA.id) match.scoreA += 1;
        else if (winnerTeamId === match.teamB.id) match.scoreB += 1;

        const mapObj = match.bo3Maps.find(m => m.name === mapName);
        if (mapObj) {
            mapObj.winner = winnerTeamId;
            mapObj.scoreDetail = `${scoreA}-${scoreB}`;
        }

        match.roundScoreA = 0;
        match.roundScoreB = 0;
        match.currentMapIndex = (match.currentMapIndex || 1) + 1;

        if (match.scoreA >= 2) {
            match.status = 'FINISHED';
            match.isLive = false;
            await Team.updateOne({ id: match.teamA.id }, { $inc: { wins: 1 } });
        } else if (match.scoreB >= 2) {
            match.status = 'FINISHED';
            match.isLive = false;
            await Team.updateOne({ id: match.teamB.id }, { $inc: { wins: 1 } });
        }

        await match.save();
        await checkAndAdvanceBracket();

        res.json({ success: true, match });
    } catch (err) {
        res.status(500).json({ error: "Lỗi cập nhật kết quả CS 1.6!" });
    }
});

// 7. PHỤC VỤ FILE TĨNH INDEX.HTML
app.get('*', (req, res) => {
    const possiblePaths = [
        path.join(__dirname, 'index.html'),
        path.join(__dirname, 'Index.html'),
        path.join(__dirname, 'public', 'index.html'),
        path.join(__dirname, 'public', 'Index.html'),
        path.join(__dirname, 'src', 'index.html')
    ];

    const foundPath = possiblePaths.find(p => fs.existsSync(p));
    if (foundPath) res.sendFile(foundPath);
    else res.status(404).send("❌ Không tìm thấy file index.html");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` VCT BO3 Esports Server running on port ${PORT}`);
    console.log(` MongoDB: Connected`);
    console.log(` Bracket Auto Advance: Enabled`);
    console.log(` Live Streaming Broadcast Engine: Ready`);
    console.log(`====================================================`);
});