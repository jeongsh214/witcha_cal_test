let displayMode = "value";
let latestRenderData = null;

function normalizeKey(key) {
  return String(key).replace(/\s+/g, " ").trim();
}

function parseValue(rawValue) {
  const text = String(rawValue).trim();

  const rangeMatch = text.match(/^(\d+(?:\.\d+)?)\s*~\s*(\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);

    return {
      type: "range",
      raw: text,
      min: Math.min(min, max),
      max: Math.max(min, max)
    };
  }

  const numberMatch = text.match(/^\d+(?:\.\d+)?$/);
  if (numberMatch) {
    const num = Number(text);

    return {
      type: "fixed",
      raw: text,
      min: num,
      max: num
    };
  }

  return {
    type: "text",
    raw: text,
    min: null,
    max: null
  };
}

function splitLine(line) {
  if (line.includes("\t")) {
    const parts = line.split("\t").map(v => v.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        key: parts[0],
        value: parts.slice(1).join(" ")
      };
    }
  }

  if (line.includes(":")) {
    const idx = line.indexOf(":");
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();

    if (key && value) {
      return { key, value };
    }
  }

  const parts = line.split(/\s{2,}/).map(v => v.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      key: parts[0],
      value: parts.slice(1).join(" ")
    };
  }

  return null;
}

function parseBlock(text) {
  const lines = String(text)
    .split("\n")
    .map(line => line.replace(/\r/g, "").trim())
    .filter(Boolean);

  const parsed = {
    title: "",
    fields: {}
  };

  lines.forEach((line, index) => {
    const pair = splitLine(line);

    if (!pair) {
      if (index === 0 && !parsed.title) {
        parsed.title = line;
      }
      return;
    }

    const key = normalizeKey(pair.key);
    parsed.fields[key] = parseValue(pair.value);
  });

  return parsed;
}

function parseCsvLine(line) {
  return line.split(",").map(v => v.trim());
}

function parseCsvText(csvText) {
  const lines = String(csvText)
    .split("\n")
    .map(line => line.replace(/\r/g, "").trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return {};
  }

  const headers = parseCsvLine(lines[0]);
  const result = {};

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const grade = cols[0];

    if (!grade) continue;

    const fields = {
      등급: {
        type: "text",
        raw: grade,
        min: null,
        max: null
      }
    };

    for (let j = 1; j < headers.length; j++) {
      const key = normalizeKey(headers[j]);
      const value = cols[j] ?? "";

      if (!value) continue;
      fields[key] = parseValue(value);
    }

    result[grade] = {
      title: `${grade} 기준 스텟`,
      fields
    };
  }

  return result;
}

async function loadTargetStats() {
  const response = await fetch("./target-stats.csv", { cache: "no-store" });

  if (!response.ok) {
    throw new Error("기준 CSV 파일을 불러오지 못했다.");
  }

  const csvText = await response.text();
  return parseCsvText(csvText);
}

function formatDiff(diff, baseValue) {
  if (displayMode === "percent") {
    if (!baseValue) {
      return "0%";
    }

    const percent = Math.round((Math.abs(diff) / baseValue) * 100);
    return `${percent}%`;
  }

  return String(Math.abs(diff));
}

function makePart(title, diff, fixedLabel, baseValue) {
  if (fixedLabel !== undefined) {
    return {
      title,
      text: fixedLabel,
      className: fixedLabel === "동일" ? "equal" : "under"
    };
  }

  const amount = formatDiff(diff, baseValue);

  if (diff > 0) {
    return {
      title,
      text: `${amount} 초과`,
      className: "over"
    };
  }

  if (diff < 0) {
    return {
      title,
      text: `${amount} 미달`,
      className: "under"
    };
  }

  return {
    title,
    text: "동일",
    className: "equal"
  };
}

function compareTextStat(name, charStat, targetStat) {
  const same = charStat.raw === targetStat.raw;

  return {
    name,
    status: same ? "equal" : "under",
    detail: `캐릭터: ${charStat.raw} / 기준: ${targetStat.raw}`,
    parts: [
      makePart("값", null, same ? "동일" : "불일치")
    ]
  };
}

function compareNumberStat(name, charStat, targetStat) {
  const cMin = charStat.min;
  const cMax = charStat.max;
  const tMin = targetStat.min;
  const tMax = targetStat.max;

  if (charStat.type === "fixed" && targetStat.type === "fixed") {
    const valuePart = makePart("값", cMin - tMin, undefined, tMin);

    return {
      name,
      status: valuePart.className,
      detail: `캐릭터: ${charStat.raw} / 기준: ${targetStat.raw}`,
      parts: [valuePart]
    };
  }

  if (charStat.type === "range" && targetStat.type === "fixed") {
    const minPart = makePart("최소", cMin - tMin, undefined, tMin);
    const maxPart = makePart("최대", cMax - tMin, undefined, tMin);

    let status = "equal";
    if (minPart.className === "under" || maxPart.className === "under") {
      status = "under";
    } else if (minPart.className === "over" || maxPart.className === "over") {
      status = "over";
    }

    return {
      name,
      status,
      detail: `캐릭터: ${charStat.raw} / 기준: ${targetStat.raw}`,
      parts: [minPart, maxPart]
    };
  }

  if (charStat.type === "fixed" && targetStat.type === "range") {
    const minPart = makePart("기준 최소 대비", cMin - tMin, undefined, tMin);
    const maxPart = makePart("기준 최대 대비", cMin - tMax, undefined, tMax);

    let status = "equal";
    if (minPart.className === "under" || maxPart.className === "under") {
      status = "under";
    } else if (minPart.className === "over" || maxPart.className === "over") {
      status = "over";
    }

    return {
      name,
      status,
      detail: `캐릭터: ${charStat.raw} / 기준: ${targetStat.raw}`,
      parts: [minPart, maxPart]
    };
  }

  const minPart = makePart("최소", cMin - tMin, undefined, tMin);
  const maxPart = makePart("최대", cMax - tMax, undefined, tMax);

  let status = "equal";
  if (minPart.className === "under" || maxPart.className === "under") {
    status = "under";
  } else if (minPart.className === "over" || maxPart.className === "over") {
    status = "over";
  }

  return {
    name,
    status,
    detail: `캐릭터: ${charStat.raw} / 기준: ${targetStat.raw}`,
    parts: [minPart, maxPart]
  };
}

function compareBlocks(character, target) {
  const results = [];
  const allKeys = [...new Set([
    ...Object.keys(character.fields),
    ...Object.keys(target.fields)
  ])];

  allKeys.forEach(key => {
    const charStat = character.fields[key];
    const targetStat = target.fields[key];

    if (!charStat) {
      results.push({
        name: key,
        status: "warn",
        detail: `캐릭터 입력에 ${key} 항목이 없다.`,
        parts: [
          {
            title: "상태",
            text: "캐릭터 누락",
            className: "warn"
          }
        ]
      });
      return;
    }

    if (!targetStat) {
      results.push({
        name: key,
        status: "warn",
        detail: `기준 데이터에 ${key} 항목이 없다.`,
        parts: [
          {
            title: "상태",
            text: "기준 누락",
            className: "warn"
          }
        ]
      });
      return;
    }

    if (charStat.type === "text" || targetStat.type === "text") {
      results.push(compareTextStat(key, charStat, targetStat));
      return;
    }

    results.push(compareNumberStat(key, charStat, targetStat));
  });

  return results;
}

function renderParsed(parsed) {
  const lines = Object.entries(parsed.fields).map(([key, value]) => {
    let typeLabel = "텍스트";

    if (value.type === "fixed") {
      typeLabel = "고정값";
    }

    if (value.type === "range") {
      typeLabel = "범위값";
    }

    if (value.type === "text") {
      return `<div class="parsed-line"><strong>${key}</strong>: ${value.raw} <span class="parsed-type">(${typeLabel})</span></div>`;
    }

    return `<div class="parsed-line"><strong>${key}</strong>: ${value.raw} <span class="parsed-type">(${typeLabel} / min ${value.min}, max ${value.max})</span></div>`;
  }).join("");

  return lines || '<div class="parsed-line">읽힌 항목이 없다.</div>';
}

function renderResults(character, target, results) {
  const overCount = results.filter(r => r.status === "over").length;
  const underCount = results.filter(r => r.status === "under").length;
  const equalCount = results.filter(r => r.status === "equal").length;
  const warnCount = results.filter(r => r.status === "warn").length;

  const resultHtml = results.map(item => {
    const partsHtml = (item.parts || []).map(part => `
      <div class="compare-part">
        <div class="compare-part-title">${part.title}</div>
        <div class="badge ${part.className}">${part.text}</div>
      </div>
    `).join("");

    return `
      <div class="result-item">
        <div class="result-top">
          <div class="stat-name">${item.name}</div>
        </div>
        <div class="compare-parts">${partsHtml}</div>
        <div class="stat-detail">${item.detail}</div>
      </div>
    `;
  }).join("");

  return `
    <div class="summary">
      <div class="mini-box">
        <div class="mini-label">초과</div>
        <div class="mini-value">${overCount}</div>
      </div>
      <div class="mini-box">
        <div class="mini-label">미달</div>
        <div class="mini-value">${underCount}</div>
      </div>
      <div class="mini-box">
        <div class="mini-label">동일</div>
        <div class="mini-value">${equalCount}</div>
      </div>
      <div class="mini-box">
        <div class="mini-label">누락</div>
        <div class="mini-value">${warnCount}</div>
      </div>
    </div>

    <div class="meta">
      <div class="tag">캐릭터 제목: ${character.title || "없음"}</div>
      <div class="tag">기준 제목: ${target.title || "없음"}</div>
      <div class="tag">표시 방식: ${displayMode === "percent" ? "%" : "수치"}</div>
    </div>

    <div class="section-title">비교 상세</div>
    <div class="result-list">${resultHtml || '<div class="empty">비교 결과가 없다.</div>'}</div>

    <div class="section-title">캐릭터 파싱 결과</div>
    <div class="parsed-box">${renderParsed(character)}</div>

    <div class="section-title">기준 파싱 결과</div>
    <div class="parsed-box">${renderParsed(target)}</div>
  `;
}

function getCharacterGrade(character) {
  const gradeField = character.fields["등급"];
  return gradeField ? String(gradeField.raw).trim() : "";
}

function setDisplayMode(mode) {
  displayMode = mode;

  if (valueModeBtn && percentModeBtn) {
    valueModeBtn.classList.toggle("active", mode === "value");
    percentModeBtn.classList.toggle("active", mode === "percent");
  }

  if (latestRenderData && resultArea) {
    const { character, target } = latestRenderData;
    const refreshedResults = compareBlocks(character, target);
    latestRenderData = { character, target, results: refreshedResults };
    resultArea.innerHTML = renderResults(character, target, refreshedResults);
  }
}

function applyTheme(theme) {
  document.body.classList.toggle("dark-mode", theme === "dark");

  if (themeToggleBtn) {
    themeToggleBtn.innerText = theme === "dark" ? "일반모드" : "다크모드";
  }

  localStorage.setItem("theme", theme);
}

const characterInput = document.getElementById("characterInput");
const resultArea = document.getElementById("resultArea");
const compareBtn = document.getElementById("compareBtn");
const sampleBtn = document.getElementById("sampleBtn");
const clearBtn = document.getElementById("clearBtn");
const valueModeBtn = document.getElementById("valueModeBtn");
const percentModeBtn = document.getElementById("percentModeBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");

const savedTheme = localStorage.getItem("theme") || "light";
applyTheme(savedTheme);

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    const nextTheme = document.body.classList.contains("dark-mode") ? "light" : "dark";
    applyTheme(nextTheme);
  });
}

if (valueModeBtn) {
  valueModeBtn.addEventListener("click", () => {
    setDisplayMode("value");
  });
}

if (percentModeBtn) {
  percentModeBtn.addEventListener("click", () => {
    setDisplayMode("percent");
  });
}

if (compareBtn) {
  compareBtn.addEventListener("click", async () => {
    if (!characterInput || !resultArea) return;

    try {
      const character = parseBlock(characterInput.value);
      const grade = getCharacterGrade(character);

      if (!grade) {
        latestRenderData = null;
        resultArea.innerHTML = '<div class="empty">입력값에서 등급 항목을 찾지 못했다.</div>';
        return;
      }

      const allTargets = await loadTargetStats();
      const target = allTargets[grade];

      if (!target) {
        latestRenderData = null;
        resultArea.innerHTML = `<div class="empty">기준 CSV에서 "${grade}" 등급을 찾지 못했다.</div>`;
        return;
      }

      const results = compareBlocks(character, target);
      latestRenderData = { character, target, results };
      resultArea.innerHTML = renderResults(character, target, results);
    } catch (error) {
      latestRenderData = null;
      resultArea.innerHTML = `<div class="empty">${error.message}</div>`;
    }
  });
}

if (sampleBtn) {
  sampleBtn.addEventListener("click", () => {
    if (!characterInput || !resultArea) return;

    characterInput.value = `캐릭터 스텟
등급\t차원표류
체력\t310
공격력\t28
방어력\t8
치명타 확률\t15
명중률\t100
민첩\t4~7`;

    latestRenderData = null;
    resultArea.innerHTML = '<div class="empty">샘플을 넣었다. 비교하기를 누르면 결과가 나온다.</div>';
  });
}

if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    if (!characterInput || !resultArea) return;

    characterInput.value = "";
    latestRenderData = null;
    resultArea.innerHTML = '<div class="empty">입력창을 비웠다.</div>';
  });
}