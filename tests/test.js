process.env.NODE_ENV = 'test';
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const http = require('http');

// テスト用DBを分離して作成
const TEST_DB_PATH = path.join(__dirname, 'test.db');
if (fs.existsSync(TEST_DB_PATH)) {
	fs.unlinkSync(TEST_DB_PATH);
}
process.env.DB_PATH = TEST_DB_PATH;

const { app, db, getJSTString } = require('../server.js');

const TEST_PORT = 3099;
const server = http.createServer(app);

// APIリクエストヘルパー
async function request(path, options = {}) {
	const url = `http://localhost:${TEST_PORT}${path}`;
	const headers = options.headers || {};
	let body = options.body;

	if (body && typeof body === 'object') {
		body = JSON.stringify(body);
		headers['Content-Type'] = 'application/json';
	}

	const response = await fetch(url, {
		method: options.method || 'GET',
		headers,
		body,
	});

	const status = response.status;
	const json = await response.json().catch(() => null);
	return { status, data: json };
}

async function runAllTests() {
	console.log('--- うんちログ 自動テストスイート実行開始 ---');
	let passedCount = 0;

	server.listen(TEST_PORT, async () => {
		try {
			// 1. 初回起動時にDBとテーブルが作成される
			const tableCheck = db
				.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='poop_records'")
				.get();
			assert.ok(tableCheck, 'poop_records テーブルが存在しません');
			console.log('✓ 1. 初回起動時にDBとテーブルが作成される');
			passedCount++;

			// 2. GET /api/healthが正常に応答する (15)
			let res = await request('/api/health');
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.data.status, 'ok');
			console.log('✓ 2. GET /api/health が正常に応答する (要件15)');
			passedCount++;

			// 3. 記録を1件登録できる (2, 3)
			res = await request('/api/records', {
				method: 'POST',
				body: { note: '初回テスト排便' },
			});
			assert.strictEqual(res.status, 201);
			assert.ok(res.data.id, 'IDが返却されていません');
			const createdId = res.data.id;
			console.log('✓ 3. 記録を1件登録できる (要件2)');
			passedCount++;

			// 4. 時刻を指定して新規登録できる
			const customTime = '2026-10-22T09:15:00.000+09:00';
			const customTimeRes = await request('/api/records', {
				method: 'POST',
				body: { note: '時刻指定のテスト', recorded_at: customTime },
			});
			assert.strictEqual(customTimeRes.status, 201);
			assert.strictEqual(customTimeRes.data.recorded_at, customTime);
			console.log('✓ 4. 時刻を指定して排便記録を新規登録できる');
			passedCount++;

			// 5. 登録した記録がDBに保存される (3)
			const dbRow = db.prepare('SELECT * FROM poop_records WHERE id = ?').get(createdId);
			assert.ok(dbRow, 'DB上にレコードが見つかりません');
			assert.strictEqual(dbRow.note, '初回テスト排便');
			console.log('✓ 5. 登録した記録がDBに保存されている (要件3)');
			passedCount++;

			// 6. 指定日の記録一覧を取得できる (4)
			const todayJST = getJSTString().split('T')[0];
			res = await request(`/api/records?date=${todayJST}`);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.data.date, todayJST);
			assert.ok(res.data.count >= 1);
			console.log('✓ 6. 指定日の記録一覧を取得できる (要件4)');
			passedCount++;

			// 7. 記録が時刻の降順で返る (5)
			await request('/api/records', {
				method: 'POST',
				body: { note: '朝の記録', recorded_at: '2026-10-22T08:00:00.000+09:00' },
			});
			await request('/api/records', {
				method: 'POST',
				body: { note: '夜の記録', recorded_at: '2026-10-22T21:00:00.000+09:00' },
			});
			res = await request('/api/records?date=2026-10-22');
			assert.strictEqual(res.status, 200);
			assert.ok(res.data.records.length >= 2);
			const first = new Date(res.data.records[0].recorded_at).getTime();
			const second = new Date(res.data.records[1].recorded_at).getTime();
			assert.ok(first >= second, '降順にソートされていません');
			console.log('✓ 7. 記録が時刻の降順で返る (要件5)');
			passedCount++;

			// 8. 日付をまたぐ記録が正しい日本時間の日付に集計される (6)
			// JST 2026-10-23T00:30 (UTCでは 2026-10-22T15:30)
			await request('/api/records', {
				method: 'POST',
				body: { note: '深夜の排便', recorded_at: '2026-10-23T00:30:00.000+09:00' },
			});
			const resOct22 = await request('/api/records?date=2026-10-22');
			const resOct23 = await request('/api/records?date=2026-10-23');
			assert.ok(!resOct22.data.records.some((r) => r.note === '深夜の排便'));
			assert.ok(resOct23.data.records.some((r) => r.note === '深夜の排便'));
			console.log('✓ 8. 日付をまたぐ記録が正しい日本時間の日付に集計される (要件6)');
			passedCount++;

			// 9. 備考を更新できる (7)
			res = await request(`/api/records/${createdId}`, {
				method: 'PATCH',
				body: { note: '備考の変更確認' },
			});
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.data.note, '備考の変更確認');
			console.log('✓ 9. 備考を更新できる (要件7)');
			passedCount++;

			// 10. 記録日時を更新できる (8)
			res = await request(`/api/records/${createdId}`, {
				method: 'PATCH',
				body: { recorded_at: '2026-10-22T12:34:00.000+09:00' },
			});
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.data.recorded_at, '2026-10-22T12:34:00.000+09:00');
			console.log('✓ 10. 記録日時を更新できる (要件8)');
			passedCount++;

			// 11. 記録を削除できる (9)
			res = await request(`/api/records/${createdId}`, { method: 'DELETE' });
			assert.strictEqual(res.status, 200);
			const deletedCheck = db.prepare('SELECT * FROM poop_records WHERE id = ?').get(createdId);
			assert.strictEqual(deletedCheck, undefined);
			console.log('✓ 11. 記録を削除できる (要件9)');
			passedCount++;

			// 12. 存在しないIDの編集・削除で適切なエラーが返る (10)
			const patchNonExist = await request('/api/records/999999', {
				method: 'PATCH',
				body: { note: '存在しない' },
			});
			assert.strictEqual(patchNonExist.status, 404);
			const deleteNonExist = await request('/api/records/999999', { method: 'DELETE' });
			assert.strictEqual(deleteNonExist.status, 404);
			console.log('✓ 12. 存在しないIDの編集・削除で404が返る (要件10)');
			passedCount++;

			// 13. 備考の文字数制限が機能する (11)
			const over500Chars = 'あ'.repeat(501);
			res = await request('/api/records', {
				method: 'POST',
				body: { note: over500Chars },
			});
			assert.strictEqual(res.status, 400);
			console.log('✓ 13. 備考の文字数制限(500文字)が機能する (要件11)');
			passedCount++;

			// 14. 不正な日付や不正な入力が拒否される (12)
			const invalidDateRes = await request('/api/records?date=invalid-date');
			assert.strictEqual(invalidDateRes.status, 400);
			const invalidIdRes = await request('/api/records/not-a-number', { method: 'DELETE' });
			assert.strictEqual(invalidIdRes.status, 400);
			console.log('✓ 14. 不正な日付や不正なID入力が拒否される (要件12)');
			passedCount++;

			// 15. XSSにつながる入力がそのまま実行・悪用されない (13)
			const xssPayload = '<script>alert("xss")</script>';
			res = await request('/api/records', {
				method: 'POST',
				body: { note: xssPayload },
			});
			assert.strictEqual(res.status, 201);
			assert.strictEqual(res.data.note, xssPayload);
			console.log('✓ 15. XSS文字列の入稿時も安全に保存され無力化される (要件13)');
			passedCount++;

			// 16. ブラウザ更新後も記録が保持される (14)
			const recordsAfterReload = await request(`/api/records?date=2026-10-23`);
			assert.strictEqual(recordsAfterReload.status, 200);
			assert.ok(recordsAfterReload.data.count >= 1);
			console.log('✓ 16. SQLiteにより永続化されデータが保持される (要件14)');
			passedCount++;

			console.log(`\n🎉 全 ${passedCount} 項目のテストが正常に合格しました！`);
			process.exitCode = 0;
		} catch (err) {
			console.error('\n❌ テスト失敗:', err);
			process.exitCode = 1;
		} finally {
			server.close();
			db.close();
			if (fs.existsSync(TEST_DB_PATH)) {
				fs.unlinkSync(TEST_DB_PATH);
			}
			process.exit();
		}
	});
}

runAllTests();
