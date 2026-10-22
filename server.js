const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3006; // 要件により3006固定

// DBディレクトリおよびパスの設定
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
	fs.mkdirSync(dataDir, { recursive: true });
}

const isTest = process.env.NODE_ENV === 'test';
const DB_PATH = process.env.DB_PATH || path.join(dataDir, 'poop-log.db');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// SQLite初期化
const db = new Database(DB_PATH);
if (!isTest) {
	db.pragma('journal_mode = WAL');
}

// テーブル作成 & 検索インデックス作成
db.exec(`
  CREATE TABLE IF NOT EXISTS poop_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_poop_records_recorded_at ON poop_records(recorded_at);
`);

// 日本時間（JST: UTC+9）のISO 8601拡張文字列を生成 (YYYY-MM-DDTHH:mm:ss.sss+09:00)
function getJSTString(date = new Date()) {
	const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
	return jstDate.toISOString().replace('Z', '+09:00');
}

// 入力値バリデーション用正規表現
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const datetimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(\+09:00|Z)$/;

// 1. ヘルスチェック API
app.get('/api/health', (req, res) => {
	try {
		db.prepare('SELECT 1').get();
		res.json({ status: 'ok', message: 'サーバーとデータベースは正常に稼働しています。' });
	} catch (error) {
		res.status(500).json({ error: 'データベース接続に失敗しました。' });
	}
});

// 2. 指定日の記録一覧取得 API
app.get('/api/records', (req, res) => {
	const { date } = req.query;
	if (!date || !dateRegex.test(date)) {
		return res.status(400).json({ error: '正しい日付形式(YYYY-MM-DD)を指定してください。' });
	}

	try {
		// 日本時間の当日00:00:00から翌日00:00:00未満までを集計範囲とする
		const startJST = `${date}T00:00:00.000+09:00`;

		// 翌日の日付文字列を算出
		const targetDate = new Date(`${date}T00:00:00+09:00`);
		const nextDateObj = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
		const nextYear = nextDateObj.getFullYear();
		const nextMonth = String(nextDateObj.getMonth() + 1).padStart(2, '0');
		const nextDay = String(nextDateObj.getDate()).padStart(2, '0');
		const endJST = `${nextYear}-${nextMonth}-${nextDay}T00:00:00.000+09:00`;

		const stmt = db.prepare(`
      SELECT * FROM poop_records 
      WHERE recorded_at >= ? AND recorded_at < ?
      ORDER BY recorded_at DESC, id DESC
    `);
		const records = stmt.all(startJST, endJST);

		res.json({
			date: date,
			count: records.length,
			records: records,
		});
	} catch (error) {
		res.status(500).json({ error: '記録の取得に失敗しました。' });
	}
});

// 3. 新規記録作成 API（指定日時対応）
app.post('/api/records', (req, res) => {
	let { note, recorded_at } = req.body;

	if (note !== undefined && typeof note !== 'string') {
		return res.status(400).json({ error: '備考は文字列で入力してください。' });
	}

	// 最大文字数 500文字のバリデーション
	if (note && note.length > 500) {
		return res.status(400).json({ error: '備考は500文字以内で入力してください。' });
	}
	note = note ? note.trim() : '';

	const now = new Date();
	const currentJST = getJSTString(now);

	// recorded_at が明示的に指定された場合は検証、なければ現在時刻
	let targetRecordedAt = currentJST;
	if (recorded_at) {
		if (!datetimeRegex.test(recorded_at)) {
			return res.status(400).json({ error: '日時の形式が正しくありません。' });
		}
		targetRecordedAt = recorded_at;
	}

	try {
		// 誤操作による二重登録防止（直近2秒以内の連続登録チェック。テスト時はスキップ）
		if (!isTest) {
			const twoSecondsAgo = getJSTString(new Date(now.getTime() - 2000));
			const recentCheck = db
				.prepare('SELECT id FROM poop_records WHERE created_at > ?')
				.get(twoSecondsAgo);
			if (recentCheck) {
				return res
					.status(429)
					.json({ error: '連続して記録することはできません。少し時間を置いてお試しください。' });
			}
		}

		const stmt = db.prepare(`
      INSERT INTO poop_records (recorded_at, note, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `);
		const info = stmt.run(targetRecordedAt, note, currentJST, currentJST);
		const newRecord = db
			.prepare('SELECT * FROM poop_records WHERE id = ?')
			.get(info.lastInsertRowid);

		res.status(201).json(newRecord);
	} catch (error) {
		res.status(500).json({ error: '記録の保存に失敗しました。' });
	}
});

// 4. 記録更新 API
app.patch('/api/records/:id', (req, res) => {
	const id = parseInt(req.params.id, 10);
	if (isNaN(id)) {
		return res.status(400).json({ error: '無効なIDです。' });
	}

	let { note, recorded_at } = req.body;

	try {
		const existing = db.prepare('SELECT * FROM poop_records WHERE id = ?').get(id);
		if (!existing) {
			return res.status(404).json({ error: '指定された記録が見つかりません。' });
		}

		let updatedNote = existing.note;
		if (note !== undefined) {
			if (typeof note !== 'string') {
				return res.status(400).json({ error: '備考は文字列で入力してください。' });
			}
			if (note.length > 500) {
				return res.status(400).json({ error: '備考は500文字以内で入力してください。' });
			}
			updatedNote = note.trim();
		}

		let updatedRecordedAt = existing.recorded_at;
		if (recorded_at !== undefined) {
			if (!datetimeRegex.test(recorded_at)) {
				return res.status(400).json({ error: '日時の形式が正しくありません。' });
			}
			updatedRecordedAt = recorded_at;
		}

		const currentJST = getJSTString();
		const stmt = db.prepare(`
      UPDATE poop_records 
      SET note = ?, recorded_at = ?, updated_at = ?
      WHERE id = ?
    `);
		stmt.run(updatedNote, updatedRecordedAt, currentJST, id);

		const updated = db.prepare('SELECT * FROM poop_records WHERE id = ?').get(id);
		res.json(updated);
	} catch (error) {
		res.status(500).json({ error: '記録の更新に失敗しました。' });
	}
});

// 5. 記録削除 API
app.delete('/api/records/:id', (req, res) => {
	const id = parseInt(req.params.id, 10);
	if (isNaN(id)) {
		return res.status(400).json({ error: '無効なIDです。' });
	}

	try {
		const info = db.prepare('DELETE FROM poop_records WHERE id = ?').run(id);
		if (info.changes === 0) {
			return res.status(404).json({ error: '指定された記録が見つかりません。' });
		}
		res.json({ message: '記録を削除しました。' });
	} catch (error) {
		res.status(500).json({ error: '記録の削除に失敗しました。' });
	}
});

// README取得 API（アプリ内モーダル表示用）
app.get('/api/readme', (req, res) => {
	const readmePath = path.join(__dirname, 'README.md');
	fs.readFile(readmePath, 'utf8', (err, data) => {
		if (err) {
			return res.status(500).json({ error: 'READMEの読み込みに失敗しました。' });
		}
		res.json({ content: data });
	});
});

// 404 ハンドラ
app.use((req, res) => {
	res.status(404).json({ error: 'お探しのページまたはAPIが見つかりません。' });
});

// サーバー起動
if (require.main === module) {
	app.listen(PORT, () => {
		console.log(`うんちログ サーバーがポート ${PORT} で起動しました: http://localhost:${PORT}`);
	});
}

module.exports = { app, db, getJSTString };
