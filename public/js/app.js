document.addEventListener('DOMContentLoaded', () => {
	// --- DOM要素取得 ---
	const datePicker = document.getElementById('datePicker');
	const currentDateDisplay = document.getElementById('currentDateDisplay');
	const prevDateBtn = document.getElementById('prevDateBtn');
	const nextDateBtn = document.getElementById('nextDateBtn');
	const summaryTitle = document.getElementById('summaryTitle');
	const summaryCountNumber = document.getElementById('summaryCountNumber');
	const summaryEmptyMsg = document.getElementById('summaryEmptyMsg');

	const mainRecordBtn = document.getElementById('mainRecordBtn');
	const toastFeedback = document.getElementById('toastFeedback');
	const errorBanner = document.getElementById('errorBanner');
	const historyTableContainer = document.getElementById('historyTableContainer');

	// モーダル関連
	const infoBtn = document.getElementById('infoBtn');
	const readmeModal = document.getElementById('readmeModal');
	const readmeBody = document.getElementById('readmeBody');
	const closeReadmeBtn = document.getElementById('closeReadmeBtn');
	const closeReadmeBottomBtn = document.getElementById('closeReadmeBottomBtn');

	const editModal = document.getElementById('editModal');
	const editForm = document.getElementById('editForm');
	const editRecordId = document.getElementById('editRecordId');
	const editTimeInput = document.getElementById('editTimeInput');
	const editNoteInput = document.getElementById('editNoteInput');
	const charCount = document.getElementById('charCount');
	const closeEditBtn = document.getElementById('closeEditBtn');
	const cancelEditBtn = document.getElementById('cancelEditBtn');

	const deleteModal = document.getElementById('deleteModal');
	const deleteTargetTime = document.getElementById('deleteTargetTime');
	const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

	// --- 状態管理 ---
	let selectedDate = getTodayJST();
	let targetDeleteRecord = null;
	let isSubmitting = false;

	// --- 日付計算ユーティリティ（タイムゾーンの狂いをゼロ化） ---
	function getTodayJST() {
		const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
		return jst.toISOString().split('T')[0];
	}

	// 完全に正確な1日単位の前後移動（UTCベースで計算しズレを防止）
	function shiftDays(dateStr, offset) {
		const parts = dateStr.split('-').map(Number);
		const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + offset));
		const y = d.getUTCFullYear();
		const m = String(d.getUTCMonth() + 1).padStart(2, '0');
		const day = String(d.getUTCDate()).padStart(2, '0');
		return `${y}-${m}-${day}`;
	}

	function formatDateHeader(dateStr) {
		const parts = dateStr.split('-').map(Number);
		// 曜日取得用（ローカル日時ではなくUTC基準で正しく曜日判定）
		const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
		const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
		return `${parts[0]}年${parts[1]}月${parts[2]}日(${weekDays[d.getUTCDay()]})`;
	}

	function formatTimeToHHMM(isoStr) {
		if (!isoStr) return '--:--';
		const timeMatch = isoStr.match(/T(\d{2}:\d{2})/);
		return timeMatch ? timeMatch[1] : '--:--';
	}

	function extractHourFromISO(isoStr) {
		if (!isoStr) return 0;
		const match = isoStr.match(/T(\d{2}):/);
		return match ? parseInt(match[1], 10) : 0;
	}

	function escapeHTML(str) {
		if (!str) return '';
		return str.replace(
			/[&<>'"]/g,
			(tag) =>
				({
					'&': '&amp;',
					'<': '&lt;',
					'>': '&gt;',
					"'": '&#39;',
					'"': '&quot;',
				})[tag],
		);
	}

	// Markdownテキストを見やすく整形する軽量パーサー
	function formatMarkdownToHTML(md) {
		const escaped = escapeHTML(md);
		const lines = escaped.split(/\r?\n/);
		let html = '';
		let inList = false;
		let inCodeBlock = false;

		lines.forEach((line) => {
			// コードブロック
			if (line.startsWith('```')) {
				if (inCodeBlock) {
					html += '</code></pre>\n';
					inCodeBlock = false;
				} else {
					if (inList) {
						html += '</ul>\n';
						inList = false;
					}
					html += '<pre><code>';
					inCodeBlock = true;
				}
				return;
			}

			if (inCodeBlock) {
				html += line + '\n';
				return;
			}

			// 水平線
			if (/^---{2,}$/.test(line.trim())) {
				if (inList) {
					html += '</ul>\n';
					inList = false;
				}
				html += '<hr>\n';
				return;
			}

			// 見出し
			if (line.startsWith('### ')) {
				if (inList) {
					html += '</ul>\n';
					inList = false;
				}
				html += `<h3>${line.substring(4)}</h3>\n`;
				return;
			}
			if (line.startsWith('## ')) {
				if (inList) {
					html += '</ul>\n';
					inList = false;
				}
				html += `<h2>${line.substring(3)}</h2>\n`;
				return;
			}
			if (line.startsWith('# ')) {
				if (inList) {
					html += '</ul>\n';
					inList = false;
				}
				html += `<h1>${line.substring(2)}</h1>\n`;
				return;
			}

			// 箇条書きリスト
			if (line.startsWith('- ') || line.startsWith('* ')) {
				if (!inList) {
					html += '<ul>\n';
					inList = true;
				}
				let content = line.substring(2);
				// インラインコードと太字の変換
				content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
				content = content.replace(/`(.*?)`/g, '<code>$1</code>');
				html += `<li>${content}</li>\n`;
				return;
			}

			// 空行
			if (line.trim() === '') {
				if (inList) {
					html += '</ul>\n';
					inList = false;
				}
				return;
			}

			// 通常段落
			if (inList) {
				html += '</ul>\n';
				inList = false;
			}
			let paragraph = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
			paragraph = paragraph.replace(/`(.*?)`/g, '<code>$1</code>');
			html += `<p>${paragraph}</p>\n`;
		});

		if (inList) html += '</ul>\n';
		if (inCodeBlock) html += '</code></pre>\n';

		return html;
	}

	function updateDateUI() {
		datePicker.value = selectedDate;
		currentDateDisplay.textContent = formatDateHeader(selectedDate);
		const today = getTodayJST();
		if (selectedDate === today) {
			summaryTitle.textContent = '今日のうんち';
		} else {
			const parts = selectedDate.split('-').map(Number);
			summaryTitle.textContent = `${parts[1]}月${parts[2]}日のうんち`;
		}
	}

	function showToast(message) {
		toastFeedback.textContent = message;
		toastFeedback.classList.add('show');
		setTimeout(() => {
			toastFeedback.classList.remove('show');
		}, 2400);
	}

	function showError(message) {
		errorBanner.textContent = message;
		errorBanner.classList.add('show');
		setTimeout(() => {
			errorBanner.classList.remove('show');
		}, 5000);
	}

	// --- モーダル制御 ---
	function openModal(modal) {
		if (typeof modal.showModal === 'function') {
			modal.showModal();
		} else {
			modal.setAttribute('open', '');
		}
		document.body.classList.add('modal-open');
	}

	function closeModal(modal) {
		if (typeof modal.close === 'function') {
			modal.close();
		} else {
			modal.removeAttribute('open');
		}
		document.body.classList.remove('modal-open');
	}

	// 背景クリックによるクローズ
	[readmeModal, editModal, deleteModal].forEach((modal) => {
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				closeModal(modal);
			}
		});

		const card = modal.querySelector('.dialog-card');
		if (card) {
			card.addEventListener('click', (e) => {
				e.stopPropagation();
			});
		}

		modal.addEventListener('cancel', () => {
			document.body.classList.remove('modal-open');
		});
	});

	// --- 日付ナビゲーション（確実な1日単位遷移 & カレンダー動作） ---
	prevDateBtn.addEventListener('click', () => {
		selectedDate = shiftDays(selectedDate, -1);
		updateDateUI();
		loadRecords();
	});

	nextDateBtn.addEventListener('click', () => {
		selectedDate = shiftDays(selectedDate, 1);
		updateDateUI();
		loadRecords();
	});

	datePicker.addEventListener('change', (e) => {
		if (e.target.value) {
			selectedDate = e.target.value;
			updateDateUI();
			loadRecords();
		}
	});

	// --- API連携 & タイムテーブル描画 ---
	async function loadRecords() {
		try {
			historyTableContainer.innerHTML = '<div class="skeleton-loader">読み込み中...</div>';
			const res = await fetch(`/api/records?date=${selectedDate}`);
			if (!res.ok) {
				const errorData = await res.json().catch(() => ({}));
				throw new Error(errorData.error || 'データの取得に失敗しました。');
			}
			const data = await res.json();
			renderSummary(data.count);
			renderTimetable(data.records);
		} catch (err) {
			historyTableContainer.innerHTML = `<div class="skeleton-loader">${escapeHTML(
				err.message,
			)}</div>`;
			showError(err.message);
		}
	}

	function renderSummary(count) {
		summaryCountNumber.textContent = count;
		const isToday = selectedDate === getTodayJST();
		if (count === 0) {
			summaryEmptyMsg.style.display = 'block';
			summaryEmptyMsg.textContent = isToday ? '今日はまだ記録がありません' : '記録がありません';
		} else {
			summaryEmptyMsg.style.display = 'none';
		}
	}

	// 0時〜23時のタイムテーブル
	function renderTimetable(records) {
		const hourlyMap = Array.from({ length: 24 }, () => []);

		if (records && records.length > 0) {
			records.forEach((record) => {
				const h = extractHourFromISO(record.recorded_at);
				if (h >= 0 && h <= 23) {
					hourlyMap[h].push(record);
				}
			});
		}

		const table = document.createElement('table');
		table.className = 'timetable-table';
		table.setAttribute('aria-label', 'うんちの履歴タイムテーブル');

		table.innerHTML = `
      <thead class="timetable-head">
        <tr>
          <th scope="col" class="col-hour">時間</th>
          <th scope="col" class="col-data">うんち</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

		const tbody = table.querySelector('tbody');

		for (let hour = 0; hour < 24; hour++) {
			const row = document.createElement('tr');
			const hourRecords = hourlyMap[hour];
			const hasRecord = hourRecords.length > 0;

			row.className = `time-row ${hasRecord ? 'has-item' : 'is-empty'}`;

			const hourTd = document.createElement('td');
			hourTd.className = 'hour-cell';
			hourTd.textContent = `${hour}時`;
			row.appendChild(hourTd);

			const dataTd = document.createElement('td');
			dataTd.className = 'data-cell';

			if (!hasRecord) {
				dataTd.innerHTML = '<span class="empty-dash" aria-hidden="true">-</span>';
			} else {
				const cardStack = document.createElement('div');
				cardStack.className = 'card-stack';

				hourRecords.forEach((record) => {
					const timeStr = formatTimeToHHMM(record.recorded_at);
					const chip = document.createElement('div');
					chip.className = 'poop-record-chip';

					const noteHtml = record.note
						? `<div class="chip-note">${escapeHTML(record.note)}</div>`
						: `<div class="chip-note is-empty">備考なし</div>`;

					chip.innerHTML = `
            <div class="chip-header">
              <span class="chip-time-tag">
                <svg class="chip-mini-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M16 4C14.8 4 13.8 4.9 14 6.1C14.2 7.3 13.7 8.5 12.7 9.2C10.5 10.7 9 13.2 9 16C9 17.1 9.3 18.2 9.8 19.1C8.2 19.8 7 21.4 7 23.3C7 26 9.2 28 12 28H20C22.8 28 25 26 25 23.3C25 21.4 23.8 19.8 22.2 19.1C22.7 18.2 23 17.1 23 16C23 13.2 21.5 10.7 19.3 9.2C18.3 8.5 17.8 7.3 18 6.1C18.2 4.9 17.2 4 16 4Z" fill="#E8A17D"/>
                </svg>
                <strong>${timeStr}</strong>
              </span>
              <div class="chip-actions">
                <button class="btn-icon-action edit-btn" aria-label="${timeStr} の記録を修正">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                </button>
                <button class="btn-icon-action delete-btn" aria-label="${timeStr} の記録を削除">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
              </div>
            </div>
            ${noteHtml}
          `;

					// 編集ボタン
					chip.querySelector('.edit-btn').addEventListener('click', (e) => {
						e.stopPropagation();
						editRecordId.value = record.id;
						editTimeInput.value = timeStr;
						editNoteInput.value = record.note || '';
						charCount.textContent = (record.note || '').length;
						openModal(editModal);
					});

					// 削除ボタン
					chip.querySelector('.delete-btn').addEventListener('click', (e) => {
						e.stopPropagation();
						targetDeleteRecord = record;
						deleteTargetTime.textContent = `${timeStr} の記録`;
						openModal(deleteModal);
					});

					cardStack.appendChild(chip);
				});

				dataTd.appendChild(cardStack);
			}

			row.appendChild(dataTd);
			tbody.appendChild(row);
		}

		historyTableContainer.innerHTML = '';
		historyTableContainer.appendChild(table);
	}

	// --- 排便記録メインボタン（1タップ登録） ---
	mainRecordBtn.addEventListener('click', async () => {
		if (isSubmitting) return;
		isSubmitting = true;
		mainRecordBtn.disabled = true;

		try {
			const res = await fetch('/api/records', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ note: '' }),
			});

			if (!res.ok) {
				const errData = await res.json().catch(() => ({}));
				throw new Error(errData.error || '記録に失敗しました。');
			}

			showToast('記録しました！');

			const today = getTodayJST();
			if (selectedDate !== today) {
				selectedDate = today;
				updateDateUI();
			}
			await loadRecords();
		} catch (err) {
			showError(err.message);
		} finally {
			setTimeout(() => {
				mainRecordBtn.disabled = false;
				isSubmitting = false;
			}, 700);
		}
	});

	// --- 編集フォーム操作 ---
	editNoteInput.addEventListener('input', (e) => {
		charCount.textContent = e.target.value.length;
	});

	editForm.addEventListener('submit', async (e) => {
		e.preventDefault();
		const id = editRecordId.value;
		const timeVal = editTimeInput.value;
		const noteVal = editNoteInput.value;
		const updatedRecordedAt = `${selectedDate}T${timeVal}:00.000+09:00`;

		try {
			const res = await fetch(`/api/records/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					recorded_at: updatedRecordedAt,
					note: noteVal,
				}),
			});

			if (!res.ok) {
				const errData = await res.json().catch(() => ({}));
				throw new Error(errData.error || '更新に失敗しました。');
			}

			closeModal(editModal);
			showToast('更新しました');
			loadRecords();
		} catch (err) {
			alert(err.message);
		}
	});

	cancelEditBtn.addEventListener('click', () => closeModal(editModal));
	closeEditBtn.addEventListener('click', () => closeModal(editModal));

	// --- 削除操作 ---
	confirmDeleteBtn.addEventListener('click', async () => {
		if (!targetDeleteRecord) return;
		try {
			const res = await fetch(`/api/records/${targetDeleteRecord.id}`, {
				method: 'DELETE',
			});

			if (!res.ok) {
				const errData = await res.json().catch(() => ({}));
				throw new Error(errData.error || '削除に失敗しました。');
			}

			closeModal(deleteModal);
			showToast('削除しました');
			loadRecords();
		} catch (err) {
			alert(err.message);
		} finally {
			targetDeleteRecord = null;
		}
	});

	document
		.getElementById('cancelDeleteBtn')
		.addEventListener('click', () => closeModal(deleteModal));

	// --- アプリ情報（README）モーダル ---
	infoBtn.addEventListener('click', async (e) => {
		e.stopPropagation();
		openModal(readmeModal);
		try {
			const res = await fetch('/api/readme');
			if (!res.ok) throw new Error('READMEの取得に失敗しました');
			const data = await res.json();
			readmeBody.innerHTML = formatMarkdownToHTML(data.content);
		} catch (err) {
			readmeBody.innerHTML = '<p>ドキュメントの読み込みに失敗しました。</p>';
		}
	});

	closeReadmeBtn.addEventListener('click', () => closeModal(readmeModal));
	closeReadmeBottomBtn.addEventListener('click', () => closeModal(readmeModal));

	// 初期化ロード
	updateDateUI();
	loadRecords();
});
