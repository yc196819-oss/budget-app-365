// קטגוריות ברירת מחדל חכמות - מחולקות מראש לקבוע ושוטף
const defaultData = {
  categories: [
    { name: "משכורת", group: "income", type: "fixed" },
    { name: "לימודים", group: "fixed_expenses", type: "fixed" },
    { name: "רכב", group: "fixed_expenses", type: "fixed" },
    { name: "דיור", group: "fixed_expenses", type: "fixed" },
    { name: "קניות לבית", group: "current_expenses", type: "variable" },
    { name: "בילויים", group: "current_expenses", type: "variable" },
    { name: "בריאות", group: "current_expenses", type: "variable" },
    { name: "אחר", group: "current_expenses", type: "variable" }
  ],
  transactions: [],
  budgets: {}
};

let appData = cloneData(defaultData);
let myChart = null; // משתנה שיחזיק את רכיב הגרף

function cloneData(data) { return JSON.parse(JSON.stringify(data)); }

// פונקציה מרכזית למשיכת הנתונים המלאים מהשרת
async function loadData() {
  try {
    const [transactionsRes, categoriesRes, budgetsRes] = await Promise.all([
      fetch('/api/transactions'),
      fetch('/api/categories'),
      fetch('/api/budgets')
    ]);

    if (!transactionsRes.ok || !categoriesRes.ok || !budgetsRes.ok) {
      throw new Error("Failed to fetch data from server");
    }

    const transactions = await transactionsRes.json();
    const categories = await categoriesRes.json();
    const budgets = await budgetsRes.json();

    appData.transactions = transactions;
    appData.categories = categories;
    appData.budgets = budgets;

    renderApp();
  } catch (error) {
    console.error("שגיאה במשיכת נתונים מהשרת:", error);
    showMessage("שגיאה בטעינת נתונים מהשרת", "error");
  }
}

// פונקציה לשמירת תנועה חדשה או עדכון תנועת קיים בשרת
async function saveTransactionToServer(newTx, transactionId = null) {
  try {
    const url = transactionId ? `/api/transactions/${transactionId}` : '/api/transactions';
    const method = transactionId ? 'PUT' : 'POST';

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTx)
    });
    
    if (!response.ok) throw new Error("Failed to save transaction");
    
    await loadData();
    showMessage(transactionId ? "תנועה עודכנה בהצלחה" : "תנועה נוספה בהצלחה");
  } catch (error) {
    console.error("שגיאה בשמירת התנועה:", error);
    showMessage("שגיאה בשמירת התנועה", "error");
  }
}

// פונקציה למחיקת תנועה מהשרת
async function deleteTransactionFromServer(id) {
  try {
    const response = await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
    
    if (!response.ok) throw new Error("Failed to delete transaction");
    
    await loadData();
    showMessage("תנועה נמחקה בהצלחה");
  } catch (error) {
    console.error("שגיאה במחיקת התנועה:", error);
    showMessage("שגיאה במחיקת התנועה", "error");
  }
}

function editTransaction(transactionId) {
  const tx = appData.transactions.find(t => t.id === transactionId);
  if (!tx) return;

  document.getElementById("editId").value = tx.id;
  document.getElementById("type").value = tx.type;
  document.getElementById("description").value = tx.description || "";
  document.getElementById("amount").value = tx.amount || "";
  document.getElementById("category").value = tx.category || "";
  document.getElementById("date").value = tx.date || getTodayDate();
  document.getElementById("paymentMethod").value = tx.paymentMethod || 'אשראי';
  document.getElementById("formTitle").textContent = "עריכת תנועה";
}

// פונקציה להוספת קטגוריה חדשה לשרת
async function addCategoryToServer(name, type) {
  try {
    const response = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type })
    });
    
    if (!response.ok) throw new Error("Failed to add category");
    
    await loadData();
    showMessage("קטגוריה חדשה נוספה");
  } catch (error) {
    console.error("שגיאה בהוספת קטגוריה:", error);
    showMessage("שגיאה בהוספת קטגוריה", "error");
  }
}

// פונקציה למחיקת קטגוריה מהשרת
async function deleteCategoryFromServer(categoryId) {
  try {
    const response = await fetch(`/api/categories/${categoryId}`, { method: 'DELETE' });
    
    if (!response.ok) throw new Error("Failed to delete category");
    
    await loadData();
    showMessage("קטגוריה נמחקה בהצלחה");
  } catch (error) {
    console.error("שגיאה במחיקת קטגוריה:", error);
    showMessage("שגיאה במחיקת קטגוריה", "error");
  }
}

// פונקציה להגדרת תקציב בשרת
async function setBudgetOnServer(categoryName, amount, period) {
  try {
    const response = await fetch('/api/budgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryName, amount, period })
    });
    
    if (!response.ok) throw new Error("Failed to set budget");
    
    await loadData();
    showMessage("תקציב עודכן בהצלחה");
  } catch (error) {
    console.error("שגיאה בהגדרת תקציב:", error);
    showMessage("שגיאה בהגדרת תקציב", "error");
  }
}

// פונקציה למחיקת תקציב מהשרת
async function deleteBudgetFromServer(categoryName) {
  try {
    const response = await fetch(`/api/budgets/${encodeURIComponent(categoryName)}`, { method: 'DELETE' });
    
    if (!response.ok) throw new Error("Failed to delete budget");
    
    await loadData();
    showMessage("תקציב נמחק בהצלחה");
  } catch (error) {
    console.error("שגיאה במחיקת תקציב:", error);
    showMessage("שגיאה במחיקת תקציב", "error");
  }
}

function saveData() {
  // אין צורך ב-localStorage לאחר חיבור מלא ל-API.
}

function createId() { return `id_${Date.now()}_${Math.floor(Math.random() * 100000)}`; }

function formatCurrency(value) {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function getTodayDate() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function getCurrentMonthValue() { return getTodayDate().slice(0, 7); }

function showMessage(text, type = "success") {
  const box = document.getElementById("messageBox");
  if (!box) return;
  box.textContent = text;
  box.className = `message-box ${type === "error" ? "danger" : "success"}`;
  box.classList.remove("hidden");
  clearTimeout(showMessage.timeoutId);
  showMessage.timeoutId = setTimeout(() => box.classList.add("hidden"), 2600);
}

// עדכון ורינדור גרף העוגה הדינמי של ההוצאות
function updatePieChart(monthlyExpenses) {
  const ctx = document.getElementById('budgetPieChart');
  if (!ctx) return;

  const categoriesTotals = {};
  monthlyExpenses.forEach(t => {
    categoriesTotals[t.category] = (categoriesTotals[t.category] || 0) + t.amount;
  });

  const labels = Object.keys(categoriesTotals);
  const data = Object.values(categoriesTotals);

  if (myChart) {
    myChart.destroy();
  }

  if (labels.length === 0) {
    ctx.style.display = 'none';
    ctx.parentElement.style.minHeight = '50px';
    const existingNoData = document.getElementById('noChartData');
    if (!existingNoData) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';
      emptyDiv.id = 'noChartData';
      emptyDiv.textContent = 'אין הוצאות להצגה בחודש זה.';
      ctx.parentElement.appendChild(emptyDiv);
    }
    myChart = null;
    return;
  }

  const noDataEl = document.getElementById('noChartData');
  if (noDataEl) noDataEl.remove();
  ctx.style.display = 'block';

  myChart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: [
          '#2563eb', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'
        ],
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { font: { family: 'system-ui' } } }
      }
    }
  });
}

function renderSummary() {
  const currentMonth = document.getElementById("filterMonth")?.value || getCurrentMonthValue();
  const monthlyTransactions = appData.transactions.filter(t => String(t.date).startsWith(currentMonth));

  const totalIncome = monthlyTransactions.filter(t => t.type === "income").reduce((sum, t) => sum + t.amount, 0);
  const expenses = monthlyTransactions.filter(t => t.type === "expense");
  
  const fixedExpense = expenses.filter(t => t.paymentMethod === "fixed").reduce((sum, t) => sum + t.amount, 0);
  const variableExpense = expenses.filter(t => t.paymentMethod === "variable").reduce((sum, t) => sum + t.amount, 0);
  
  const totalExpense = fixedExpense + variableExpense;
  const totalBalance = totalIncome - totalExpense;

  if(document.getElementById("totalIncome")) document.getElementById("totalIncome").textContent = formatCurrency(totalIncome);
  if(document.getElementById("totalExpense")) document.getElementById("totalExpense").textContent = formatCurrency(totalExpense);
  if(document.getElementById("totalBalance")) document.getElementById("totalBalance").textContent = formatCurrency(totalBalance);
  
  const expenseTrend = document.getElementById("expenseTrend");
  if (expenseTrend) {
    expenseTrend.innerHTML = `קבועות: ${formatCurrency(fixedExpense)} | שוטפות: <span style="color:#dc2626; font-weight:bold;">${formatCurrency(variableExpense)}</span>`;
  }

  const balanceStatus = document.getElementById("balanceStatus");
  if (balanceStatus) {
    balanceStatus.textContent = totalBalance >= 0 ? "אתה בפלוס החודש" : "שים לב - חריגה מההכנסות החודש";
  }

  updatePieChart(expenses);
}

function renderCategoryOptions() {
  const elements = [document.getElementById("category"), document.getElementById("filterCategory"), document.getElementById("budgetCategory")];
  elements.forEach(el => { 
    if(el) el.innerHTML = el.id === "filterCategory" ? '<option value="all">כל הקטגוריות</option>' : ''; 
  });

  if (appData.categories && Array.isArray(appData.categories)) {
    appData.categories.forEach((cat) => {
      elements.forEach(el => {
        if(el) {
          const opt = document.createElement("option");
          opt.value = cat.name;
          const typeLabel = cat.type === 'fixed' ? 'קבוע' : (cat.type === 'income' ? 'הכנסה' : 'שוטף');
          opt.textContent = `${cat.name} (${typeLabel})`;
          el.appendChild(opt);
        }
      });
    });
  }
}

function renderCategoriesList() {
  const list = document.getElementById("categoriesList");
  if (!list) return;
  list.innerHTML = "";

  appData.categories.forEach((cat) => {
    const li = document.createElement("li");
    const typeLabel = cat.type === 'fixed' ? 'קבוע' : cat.type === 'variable' ? 'שוטף' : 'הכנסה';
    li.innerHTML = `
      <span><strong>${cat.name}</strong> <small style="color:var(--text-muted)">(${typeLabel})</small></span>
      <button class="btn-delete-text" data-category-id="${cat.id}">×</button>
    `;
    list.appendChild(li);
  });
  document.querySelectorAll("[data-category-id]").forEach(b => b.addEventListener("click", () => deleteCategory(b.dataset.categoryId)));
}

function renderBudgetList() {
  const fixedList = document.getElementById("fixedBudgetList");
  const variableList = document.getElementById("variableBudgetList");
  if (!fixedList || !variableList) return;

  fixedList.innerHTML = "";
  variableList.innerHTML = "";

  const activeBudgets = appData.categories.filter(c => appData.budgets[c.name]);

  if (!activeBudgets.length) {
    fixedList.innerHTML = '<div class="empty-state">אין תקציבים קבועים.</div>';
    variableList.innerHTML = '<div class="empty-state">אין תקציבים שוטפים.</div>';
    return;
  }

  activeBudgets.forEach((cat) => {
    const budgetData = appData.budgets[cat.name];
    let rawBudget = 0;
    let isYearly = false;

    if (typeof budgetData === "object" && budgetData !== null) {
      rawBudget = Number(budgetData.amount) || 0;
      isYearly = budgetData.period === "yearly";
    } else {
      rawBudget = Number(budgetData) || 0;
    }

    const monthlyTarget = isYearly ? (rawBudget / 12) : rawBudget;
    const currentMonth = document.getElementById("filterMonth")?.value || getCurrentMonthValue();
    const spentThisMonth = appData.transactions
      .filter(t => t.type === "expense" && t.category === cat.name && String(t.date).startsWith(currentMonth))
      .reduce((sum, t) => sum + t.amount, 0);

    const percent = monthlyTarget > 0 ? Math.min((spentThisMonth / monthlyTarget) * 100, 100) : 0;
    const remaining = monthlyTarget - spentThisMonth;

    const item = document.createElement("div");
    item.className = "budget-progress-item";
    item.innerHTML = `
      <div class="budget-info">
        <span><strong>${cat.name}</strong> ${isYearly ? '<span class="badge" style="background:#dbeafe; color:#1e40af;">פריסה שנתית</span>' : ''}</span>
        <span>${formatCurrency(spentThisMonth)} / ${formatCurrency(monthlyTarget)}</span>
      </div>
      <div class="budget-progress">
        <div class="budget-progress-fill ${spentThisMonth > monthlyTarget ? 'danger' : spentThisMonth > monthlyTarget * 0.8 ? 'warning' : ''}" style="width:${percent}%"></div>
      </div>
      <div class="budget-info" style="margin-top: 4px;">
        <small style="color: ${remaining >= 0 ? 'green' : 'red'}">
          ${remaining >= 0 ? `נותרו החודש ${formatCurrency(remaining)}` : `חריגה חודשית של ${formatCurrency(Math.abs(remaining))}`}
        </small>
        <span style="font-size:11px; color:var(--text-muted);">${isYearly ? `(מתוך ${formatCurrency(rawBudget)} לשנה)` : ''}</span>
        <button class="btn-delete-text" style="font-size:13px;" data-budget-category="${cat.name}">מחק</button>
      </div>
    `;

    if (cat.type === "fixed") {
      fixedList.appendChild(item);
    } else {
      variableList.appendChild(item);
    }
  });

  if (!fixedList.children.length) fixedList.innerHTML = '<div class="empty-state">אין תקציבים קבועים מוגדרים.</div>';
  if (!variableList.children.length) variableList.innerHTML = '<div class="empty-state">אין תקציבים שוטפים מוגדרים.</div>';

  document.querySelectorAll("[data-budget-category]").forEach(b => b.addEventListener("click", () => deleteBudget(b.dataset.budgetCategory)));
}

function attachTransactionActionListeners() {
  document.querySelectorAll('.btn-edit-transaction').forEach(button => {
    button.addEventListener('click', () => editTransaction(button.dataset.transactionId));
  });
  document.querySelectorAll('.btn-delete-transaction').forEach(button => {
    button.addEventListener('click', () => deleteTransactionFromServer(button.dataset.transactionId));
  });
}

function renderApp() {
  renderCategoryOptions();
  renderCategoriesList();
  renderSummary();
  renderBudgetList();
  renderTransactionsList();
  attachTransactionActionListeners();
}

// פונקציה לחיקת קטגוריה
function deleteCategory(categoryId) {
  const categoryName = appData.categories.find(c => c.id === categoryId)?.name;
  if (confirm(`האם למחוק את הקטגוריה "${categoryName}"?`)) {
    deleteCategoryFromServer(categoryId);
  }
}

// פונקציה למחיקת תקציב
function deleteBudget(categoryName) {
  if (confirm(`האם למחוק את התקציב של "${categoryName}"?`)) {
    deleteBudgetFromServer(categoryName);
  }
}

function renderTransactionsList() {
  const currentMonth = document.getElementById("filterMonth")?.value || getCurrentMonthValue();

  let filtered = appData.transactions.filter(t => String(t.date).startsWith(currentMonth));

  const tbody = document.getElementById("transactionsTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  filtered.forEach(tx => {
    const row = document.createElement("tr");
    const color = tx.type === 'income' ? 'green' : 'red';
    const sign = tx.type === 'income' ? '+' : '-';
    row.innerHTML = `
      <td>${tx.date}</td>
      <td>${tx.category}</td>
      <td>${tx.description}</td>
      <td style="color: ${color}; font-weight: bold;">${sign}${formatCurrency(tx.amount)}</td>
      <td>
        <button class="btn btn-secondary btn-edit-transaction" data-transaction-id="${tx.id}" style="margin-inline-end:4px;">ערוך</button>
        <button class="btn btn-danger btn-delete-transaction" data-transaction-id="${tx.id}">מחק</button>
      </td>
    `;
    tbody.appendChild(row);
  });

  const cardsContainer = document.getElementById("transactionsCards");
  if (!cardsContainer) return;
  cardsContainer.innerHTML = "";

  filtered.forEach(tx => {
    const card = document.createElement("div");
    card.className = "mobile-tx-card";
    const color = tx.type === 'income' ? 'green' : 'red';
    const sign = tx.type === 'income' ? '+' : '-';
    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; gap: 8px; align-items: flex-start;">
        <div>
          <strong>${tx.category}</strong><br>
          <small style="color: var(--text-muted);">${tx.description}</small><br>
          <small style="color: var(--text-muted);">${tx.date}</small>
        </div>
        <div style="text-align: left; color: ${color}; font-weight: bold; min-width: 90px;">
          ${sign}${formatCurrency(tx.amount)}
        </div>
      </div>
      <div style="margin-top: 8px; display: flex; gap: 8px; justify-content: flex-end;">
        <button class="btn btn-secondary btn-edit-transaction" data-transaction-id="${tx.id}">ערוך</button>
        <button class="btn btn-danger btn-delete-transaction" data-transaction-id="${tx.id}">מחק</button>
      </div>
    `;
    cardsContainer.appendChild(card);
  });
}

// ==================== EVENT LISTENERS ====================

document.getElementById("transactionForm")?.addEventListener("submit", (e) => {
  e.preventDefault();
  
  const editId = document.getElementById("editId").value;
  const type = document.getElementById("type").value;
  const description = document.getElementById("description").value;
  const amount = parseFloat(document.getElementById("amount").value);
  const category = document.getElementById("category").value;
  const date = document.getElementById("date").value;
  const paymentMethod = document.getElementById("paymentMethod").value;

  if (!description || !amount || !category || !date) {
    showMessage("בדוק שכל השדות מלאים", "error");
    return;
  }

  const newTx = {
    type: type === 'income' ? 'income' : 'expense',
    description,
    amount,
    category,
    date,
    paymentMethod,
    notes: ""
  };

  saveTransactionToServer(newTx, editId || null);
  document.getElementById("transactionForm").reset();
  document.getElementById("editId").value = "";
  document.getElementById("formTitle").textContent = "הוספת תנועה";
});

document.getElementById("categoryForm")?.addEventListener("submit", (e) => {
  e.preventDefault();
  
  const categoryName = document.getElementById("categoryName").value;
  const categoryType = document.getElementById("categoryType").value;

  if (!categoryName) {
    showMessage("הזן שם קטגוריה", "error");
    return;
  }

  const categoryExists = appData.categories.some(c => c.name === categoryName);
  if (categoryExists) {
    showMessage("קטגוריה זו כבר קיימת", "error");
    return;
  }

  addCategoryToServer(categoryName, categoryType);
  document.getElementById("categoryForm").reset();
});

document.getElementById("budgetForm")?.addEventListener("submit", (e) => {
  e.preventDefault();
  
  const categoryName = document.getElementById("budgetCategory").value;
  const amount = parseFloat(document.getElementById("budgetAmount").value);
  const period = document.getElementById("budgetPeriod").value;

  if (!categoryName || !amount || amount <= 0) {
    showMessage("בחר קטגוריה והזן סכום חיובי", "error");
    return;
  }

  setBudgetOnServer(categoryName, amount, period);
  document.getElementById("budgetForm").reset();
});

document.getElementById("filterMonth")?.addEventListener("change", () => {
  renderApp();
});

document.getElementById("resetDataBtn")?.addEventListener("click", () => {
  if (confirm("האם אתה בטוח שתרצה למחוק את כל הנתונים? פעולה זו לא ניתן לשחזורה!")) {
    // מחיקת כל התנועות
    appData.transactions.forEach(tx => {
      fetch(`/api/transactions/${tx.id}`, { method: 'DELETE' }).catch(e => console.error(e));
    });
    appData = cloneData(defaultData);
    renderApp();
    showMessage("כל הנתונים נמחקו");
  }
});

// Set today's date as default
document.getElementById("date")?.setAttribute("value", getTodayDate());
document.getElementById("filterMonth")?.setAttribute("value", getCurrentMonthValue());

// טעינה התחלתית
loadData();
