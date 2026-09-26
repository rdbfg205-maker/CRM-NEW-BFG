'use strict';
// ============ Geographic reference data (Province → City) ============
// Reference data for the cascading selectors (the 31 real provinces of Iran +
// their major cities). Industrial cities are REAL records in the DB, not here.
import { api } from './core.js';
import { el, openModal, toast } from './ui.js';

export const PROVINCES = [
  'آذربایجان شرقی', 'آذربایجان غربی', 'اردبیل', 'اصفهان', 'البرز', 'ایلام', 'بوشهر',
  'چهارمحال و بختیاری', 'خراسان جنوبی', 'خراسان رضوی', 'خراسان شمالی', 'خوزستان',
  'زنجان', 'سمنان', 'سیستان و بلوچستان', 'فارس', 'گیلان', 'گلستان', 'کردستان',
  'کهگیلویه و بویراحمد', 'کرمان', 'قزوین', 'قم', 'لرستان', 'مازندران', 'مرکزی',
  'هرمزگان', 'همدان', 'یزد', 'تهران',
];

export const CITIES_BY_PROVINCE = {
  'آذربایجان شرقی': ['تبریز', 'مراغه', 'مرند', 'اهر', 'شبستر', 'میانه', 'بناب', 'سراوان'],
  'آذربایجان غربی': ['ارومیه', 'میانه', 'خوی', 'مهاباد', 'بوکان', 'قره‌باغ', 'تیکمی'],
  'اردبیل': ['اردبیل', 'مشگین‌شهر', 'پارس‌آباد', 'خلخال', 'مشخر', 'گرمی'],
  'اصفهان': ['اصفهان', 'کاشان', 'خمینی‌شهر', 'نجف‌آباد', 'شاهین‌شهر', 'فراشبند', 'لار', 'دلیجان'],
  'البرز': ['کرج', 'فردیس', 'نظرآباد', 'هشتگرد', 'نوادشهر', 'طالقان'],
  'ایلام': ['ایلام', 'دهلران', 'آبدانان', 'مهران', 'دهدشت'],
  'بوشهر': ['بوشهر', 'کنگان', 'برازجان', 'گناوه', 'دیر', 'عسلویه', 'بندر بوشهر'],
  'چهارمحال و بختیاری': ['شهرکرد', 'بروجن', 'فارسان', 'لردگان'],
  'خراسان جنوبی': ['بیرجند', 'قائن', 'طبس', 'فردوس'],
  'خراسان رضوی': ['مشهد', 'نیشابور', 'سبزوار', 'تربت حیدریه', 'تربت جام', 'قوچان', 'چناران', 'کاشمر'],
  'خراسان شمالی': ['بجنورد', 'شیروان', 'آشخانه', 'اسفراین', 'آرازو'],
  'خوزستان': ['اهواز', 'دزفول', 'آبادان', 'ماهشهر', 'خرمشهر', 'اندیمشک', 'دیلم', 'ایذه'],
  'زنجان': ['زنجان', 'ابهر', 'خندان', 'طارم', 'قیدار'],
  'سمنان': ['سمنان', 'شاهرود', 'دامغان', 'گرمسار', 'مهدی‌شهر'],
  'سیستان و بلوچستان': ['زاهدان', 'چابهار', 'زابل', 'ایرانشهر', 'خاش', 'سراوان'],
  'فارس': ['شیراز', 'مرودشت', 'جهرم', 'فسا', 'کازرون', 'لار', 'داراب', 'فیروزآباد', 'استهبان'],
  'گیلان': ['رشت', 'بندر انزلی', 'لنگرود', 'تالش', 'صومعه‌سرا', 'آستارا'],
  'گلستان': ['گرگان', 'گنبد کاووس', 'بندر ترکمن', 'علی‌آباد', 'کردکوی', 'آق‌قلا'],
  'کردستان': ['سنندج', 'سقز', 'قروه', 'بیجار', 'مریوان', 'بانه'],
  'کهگیلویه و بویراحمد': ['یاسوج', 'دهدشت', 'لیکک', 'کیسان', 'چلگرد'],
  'کرمان': ['کرمان', 'سیرجان', 'جیرفت', 'رفسنجان', 'بم', 'زرند'],
  'قزوین': ['قزوین', 'تاکستان', 'آبیک', 'بوئین‌زهره', 'الوند'],
  'قم': ['قم', 'جعفریه', 'کهک'],
  'لرستان': ['خرم‌آباد', 'بروجرد', 'دورود', 'الشتر', 'کوهدشت'],
  'مازندران': ['ساری', 'بابل', 'قائم‌شهر', 'آمل', 'بابلسر', 'چالوس', 'تنکابن', 'فریدونکنار', 'بهشهر'],
  'مرکزی': ['اراک', 'خمین', 'ساوه', 'محلات', 'خمسار'],
  'هرمزگان': ['بندرعباس', 'میناب', 'بندر لنگه', 'قشم', 'هرمز', 'بندر جاسک'],
  'همدان': ['همدان', 'ملایر', 'نهاوند', 'تویسرکان', 'اسدآباد'],
  'یزد': ['یزد', 'میبد', 'اردکان', 'مهریز', 'بافق'],
  'تهران': ['تهران', 'اسلامشهر', 'شهرری', 'پاکدشت', 'فیروزکوه', 'دماوند', 'شهریار'],
};

// ---------- industrial cities registry (real DB records) ----------
export function fetchIndustrialCities(city, province) {
  const u = new URLSearchParams();
  if (city) u.set('city', city);
  if (province) u.set('province', province);
  return api.get('/api/industrial-cities?' + u.toString()).then(r => r.items || []).catch(() => []);
}

// Wire a cascading trio: provinceSel → cityIn (datalist) → indCityIn (datalist + add-new)
export function wireGeoCascade({ provinceSel, cityIn, indCityIn, indWrap, attachTo = null }, opts = {}) {
  const { canCreate = false, onIndChange = null } = opts;
  let dlCities = null, dlInd = null;
  if (cityIn && cityIn.tagName === 'INPUT') {
    dlCities = document.createElement('datalist');
    dlCities.id = 'dl-geo-cities-' + Math.random().toString(36).slice(2, 8);
    cityIn.setAttribute('list', dlCities.id);
    if (attachTo) attachTo.append(dlCities);
  }
  if (indCityIn && indCityIn.tagName === 'INPUT') {
    dlInd = document.createElement('datalist');
    dlInd.id = 'dl-geo-ind-' + Math.random().toString(36).slice(2, 8);
    indCityIn.setAttribute('list', dlInd.id);
    if (attachTo) attachTo.append(dlInd);
  }
  function fillCities() {
    if (!dlCities) return;
    const p = provinceSel ? provinceSel.value : '';
    const list = CITIES_BY_PROVINCE[p] || [];
    dlCities.innerHTML = '';
    list.forEach(c => { const o = document.createElement('option'); o.value = c; dlCities.appendChild(o); });
    if (cityIn && cityIn.value && !list.includes(cityIn.value)) {
      const o = document.createElement('option'); o.value = cityIn.value; dlCities.appendChild(o);
    }
  }
  async function fillInd() {
    if (!dlInd) return;
    const items = await fetchIndustrialCities(cityIn ? cityIn.value.trim() : '', provinceSel ? provinceSel.value : '');
    dlInd.innerHTML = '';
    items.forEach(c => { const o = document.createElement('option'); o.value = c.name; dlInd.appendChild(o); });
  }
  if (provinceSel) provinceSel.addEventListener('change', () => { if (cityIn) cityIn.value = ''; fillCities(); fillInd(); });
  if (cityIn) cityIn.addEventListener('change', () => fillInd());
  fillCities(); fillInd();
  if (canCreate && indCityIn && indWrap) {
    const addBtn = el('button', { class: 'btn sm', style: 'width:100%', title: 'ثبت شهرک صنعتی جدید در دیتابیس' }, '＋ شهرک صنعتی جدید');
    addBtn.addEventListener('click', () => openNewIndustrialCityModal({
      defaultProvince: provinceSel ? provinceSel.value : '', defaultCity: cityIn ? cityIn.value.trim() : '',
      onSaved: (name) => { if (indCityIn) indCityIn.value = name; if (onIndChange) onIndChange(name); fillInd(); },
    }));
    indWrap.append(addBtn);
  }
  return { fillCities, fillInd };
}

function openNewIndustrialCityModal({ defaultProvince = '', defaultCity = '', onSaved = null }) {
  const nameIn = el('input', { placeholder: 'نام شهرک صنعتی * (مثلاً: شهرک صنعتی امیرکبیر)' });
  const pvSel = el('select', {}, el('option', { value: '' }, '— انتخاب استان —'), PROVINCES.map(p => el('option', { value: p }, p)));
  const ctSel = el('select', {}, el('option', { value: '' }, '— انتخاب شهر —'));
  function fillCt() {
    ctSel.innerHTML = '';
    ctSel.append(el('option', { value: '' }, '— انتخاب شهر —'));
    (CITIES_BY_PROVINCE[pvSel.value] || []).forEach(c => ctSel.append(el('option', { value: c }, c)));
    if (defaultCity && pvSel.value && !(CITIES_BY_PROVINCE[pvSel.value] || []).includes(defaultCity)) ctSel.append(el('option', { value: defaultCity }, defaultCity));
  }
  pvSel.addEventListener('change', fillCt);
  pvSel.value = defaultProvince; fillCt();
  if (defaultCity) ctSel.value = defaultCity;
  const ov = openModal('شهرک صنعتی جدید (ثبت در دیتابیس)', el('div', { class: 'form-grid' },
    el('div', { class: 'field' }, el('label', {}, 'نام شهرک *'), nameIn),
    el('div', { class: 'field' }, el('label', {}, 'استان'), pvSel),
    el('div', { class: 'field' }, el('label', {}, 'شهر'), ctSel),
  ), { footer: [
    el('button', { class: 'btn', onclick: () => ov.close() }, 'انصراف'),
    el('button', { class: 'btn primary', onclick: async (e) => {
      if (!nameIn.value.trim()) return toast('نام شهرک الزامی است', 'err');
      if (!pvSel.value) return toast('استان را انتخاب کنید', 'err');
      e.target.disabled = true;
      try {
        await api.post('/api/industrial-cities', { name: nameIn.value.trim(), province: pvSel.value, city: ctSel.value });
        toast('شهرک صنعتی ثبت شد', 'ok'); ov.close();
        if (onSaved) onSaved(nameIn.value.trim());
      } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
    } }, 'ثبت'),
  ] });
  return ov;
}
