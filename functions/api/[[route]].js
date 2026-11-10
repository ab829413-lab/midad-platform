/**
 * خادم مِداد المتطورة (MIDAD Pro Engine)
 * Cloudflare Pages Function (functions/api/[[route]].js)
 */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-goog-api-key, X-Admin-Key',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const jsonHeaders = {
    ...corsHeaders,
    'Content-Type': 'application/json; charset=utf-8',
  };

  try {
    const adminSecret = env.ADMIN_SECRET_KEY || 'AdelAdmin2026';

    // 1. مسار لوحة الإدارة: توليد الأكواد
    if ((path.endsWith('/api/admin/create-code') || path.endsWith('/api/admin/generate-code')) && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const adminKey = request.headers.get('X-Admin-Key') || body.secretKey;

      if (adminKey !== adminSecret) {
        return new Response(JSON.stringify({ error: 'كلمة مرور الإدارة غير صحيحة.' }), { status: 401, headers: jsonHeaders });
      }

      const tasks = parseInt(body.tasksCount, 10);
      if (isNaN(tasks) || tasks < 1 || tasks > 15) {
        return new Response(JSON.stringify({ error: 'عدد المهام يجب أن يكون بين 1 و 15.' }), { status: 400, headers: jsonHeaders });
      }

      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let randomCode = `MID-${tasks}T-`;
      for (let i = 0; i < 5; i++) {
        randomCode += chars.charAt(Math.floor(Math.random() * chars.length));
      }

      const codePayload = {
        code: randomCode,
        initialTasks: tasks,
        totalTasks: tasks,
        remainingTasks: tasks,
        tasksRemaining: tasks,
        studentName: body.studentName || 'طالب دبلوم',
        track: body.track || 'عام',
        notes: body.notes || '',
        createdAt: new Date().toISOString(),
        status: 'active'
      };

      if (env.MIDAD_KV) {
        await env.MIDAD_KV.put(`code:${randomCode}`, JSON.stringify(codePayload));
        let list = [];
        const rawList = await env.MIDAD_KV.get('codes:index');
        if (rawList) {
          try { list = JSON.parse(rawList); } catch(e) {}
        }
        list.unshift(randomCode);
        await env.MIDAD_KV.put('codes:index', JSON.stringify(list.slice(0, 200)));
      }

      return new Response(JSON.stringify({ success: true, codeData: codePayload }), { status: 200, headers: jsonHeaders });
    }

    // 2. مسار لوحة الإدارة: استعراض الأكواد
    if (path.endsWith('/api/admin/list-codes')) {
      let adminKey = request.headers.get('X-Admin-Key');
      if (!adminKey && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        adminKey = body.secretKey;
      }

      if (adminKey !== adminSecret) {
        return new Response(JSON.stringify({ error: 'غير مصرح لك بالدخول.' }), { status: 401, headers: jsonHeaders });
      }

      let codes = [];
      if (env.MIDAD_KV) {
        const rawList = await env.MIDAD_KV.get('codes:index');
        if (rawList) {
          try {
            const list = JSON.parse(rawList);
            for (const c of list) {
              const raw = await env.MIDAD_KV.get(`code:${c}`);
              if (raw) codes.push(JSON.parse(raw));
            }
          } catch(e) {}
        } else {
          const listRes = await env.MIDAD_KV.list({ prefix: 'code:' });
          for (const k of listRes.keys) {
            const raw = await env.MIDAD_KV.get(k.name);
            if (raw) codes.push(JSON.parse(raw));
          }
        }
      }

      return new Response(JSON.stringify({ codes }), { status: 200, headers: jsonHeaders });
    }

    // 3. مسار التحقق من كود الطالب
    if (path.endsWith('/api/verify-code') && request.method === 'POST') {
      const { code } = await request.json().catch(() => ({}));
      if (!code) {
        return new Response(JSON.stringify({ error: 'يرجى إدخال كود التفعيل.' }), { status: 400, headers: jsonHeaders });
      }

      const cleanCode = code.trim().toUpperCase();
      let codeData = null;

      if (env.MIDAD_KV) {
        const raw = await env.MIDAD_KV.get(`code:${cleanCode}`);
        if (raw) codeData = JSON.parse(raw);
      }

      if (!codeData) {
        return new Response(JSON.stringify({ error: 'الكود المدخل غير صالح أو غير موجود.' }), { status: 404, headers: jsonHeaders });
      }

      const remaining = codeData.remainingTasks !== undefined ? codeData.remainingTasks : codeData.tasksRemaining;
      if (codeData.status === 'exhausted' || remaining <= 0) {
        return new Response(JSON.stringify({ error: 'تم استهلاك جميع المهام المخصصة لهذا الكود.' }), { status: 403, headers: jsonHeaders });
      }

      return new Response(JSON.stringify({
        valid: true,
        tasksRemaining: remaining,
        remainingTasks: remaining,
        totalTasks: codeData.totalTasks || codeData.initialTasks,
        studentName: codeData.studentName || 'طالب مِداد',
      }), { status: 200, headers: jsonHeaders });
    }

    // 4. مسار البحث الأكاديمي عبر OpenAlex
    if ((path.endsWith('/api/academic-search') || path.endsWith('/api/references')) && request.method === 'POST') {
      const { query } = await request.json().catch(() => ({}));
      if (!query) {
        return new Response(JSON.stringify({ error: 'يرجى تحديد مصطلح البحث.' }), { status: 400, headers: jsonHeaders });
      }

      const openAlexUrl = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=5`;
      const res = await fetch(openAlexUrl, {
        headers: { 'User-Agent': 'MIDAD-Academic-Platform (mailto:adelaliana2022@gmail.com)' }
      });

      if (!res.ok) {
        return new Response(JSON.stringify({ sources: [] }), { status: 200, headers: jsonHeaders });
      }

      const data = await res.json();
      const sources = (data.results || []).map(item => {
        const authors = (item.authorships || []).map(a => a.author.display_name).join(', ') || 'مؤلف غير محدد';
        const year = item.publication_year || 'بلا تاريخ';
        const title = item.title || 'عنوان غير متوفر';
        const doi = item.doi || (item.primary_location && item.primary_location.landing_page_url) || '';
        return {
          title,
          authors,
          year,
          doi,
          apaCitation: `${authors} (${year}). ${title}. ${doi}`
        };
      });

      return new Response(JSON.stringify({ sources }), { status: 200, headers: jsonHeaders });
    }

    // 5. مسار تنفيذ مهام الدبلوم والذكاء الاصطناعي (Gemini Core)
    if ((path.endsWith('/api/execute-task') || path.endsWith('/api/midad-engine')) && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { code, track, mode, taskPrompt, rubricData, fileBase64, mimeType } = body;

      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'مفتاح GEMINI_API_KEY غير مضاف في إعدادات Cloudflare.' }), { status: 500, headers: jsonHeaders });
      }

      const cleanCode = (code || '').trim().toUpperCase();
      let codeRecord = null;
      if (env.MIDAD_KV) {
        const raw = await env.MIDAD_KV.get(`code:${cleanCode}`);
        if (raw) codeRecord = JSON.parse(raw);
      }

      const rem = codeRecord ? (codeRecord.remainingTasks !== undefined ? codeRecord.remainingTasks : codeRecord.tasksRemaining) : 0;
      if (!codeRecord || rem <= 0) {
        return new Response(JSON.stringify({ error: 'رصيد المهام لهذا الكود منتهٍ أو الكود غير صالح.' }), { status: 403, headers: jsonHeaders });
      }

      let systemInstruction = `أنت منصة «مِداد | MIDAD» المساعد الأكاديمي والتربوي لطلبة الدبلوم المهني لإعداد المعلمين.
أنت خبير تربوي معتمد في معايير أكاديمية الملكة رانيا، وتلتزم التزاماً صارماً بأخلاقيات البحث العلمي والأصالة:
- المسار المختار: ${track === 'in_service' ? 'أثناء الخدمة (خبرة تدريسية وميدان حقيقي)' : 'قبل الخدمة (تدريب ميداني وتطبيق افتراضي مقنن)'}.
- لا تختلق أي بيانات أو أرقام أو استشهادات أو نسب فحص من عندك.
- حافظ على أسلوب الكتابة الأكاديمية وصوت الطالب الأردني الرصين.
- نسق التوثيق المطلوب هو APA 7 مع ذكر المصادر بدقة.\n`;

      if (rubricData) {
        systemInstruction += `\nمعايير التقييم (Rubric) الإلزامية:\n${rubricData}\n`;
      }

      const promptText = taskPrompt || body.studentInput || '';
      const promptParts = [
        { text: `${systemInstruction}\n\nالمهمة المطلوبة من الطالب:\n${promptText}` }
      ];

      if (fileBase64 && mimeType) {
        promptParts.push({
          inlineData: {
            mimeType: mimeType,
            data: fileBase64
          }
        });
      }

      const requestedPro = (mode === 'draft_writer' || fileBase64);
      const modelCandidates = requestedPro 
        ? ['gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-pro'] 
        : ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

      let generatedText = '';
      let successfulModel = '';
      let lastErrorText = '';
      let lastStatus = 500;

      const geminiPayload = {
        contents: [{ role: 'user', parts: promptParts }],
        generationConfig: {
          temperature: 0.4,
          topP: 0.8,
          maxOutputTokens: 4096,
        }
      };

      for (const mName of modelCandidates) {
        try {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${mName}:generateContent`;
          const geminiResp = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey.trim()
            },
            body: JSON.stringify(geminiPayload)
          });

          if (geminiResp.ok) {
            const geminiData = await geminiResp.json();
            generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
            successfulModel = mName;
            break;
          } else {
            lastStatus = geminiResp.status;
            lastErrorText = await geminiResp.text();
            if (geminiResp.status !== 404 && geminiResp.status !== 400) {
              break;
            }
          }
        } catch (netErr) {
          lastErrorText = netErr.message;
        }
      }

      if (!generatedText) {
        return new Response(JSON.stringify({ 
          error: `تعذر الاتصال بمحرك Gemini: ${lastErrorText}. يرجى التحقق من المفتاح في إعدادات Cloudflare.` 
        }), { status: lastStatus, headers: jsonHeaders });
      }

      if (env.MIDAD_KV && codeRecord) {
        if (codeRecord.remainingTasks !== undefined) {
          codeRecord.remainingTasks = Math.max(0, codeRecord.remainingTasks - 1);
          codeRecord.tasksRemaining = codeRecord.remainingTasks;
        } else {
          codeRecord.tasksRemaining = Math.max(0, codeRecord.tasksRemaining - 1);
          codeRecord.remainingTasks = codeRecord.tasksRemaining;
        }
        if (codeRecord.remainingTasks <= 0) {
          codeRecord.status = 'exhausted';
        }
        await env.MIDAD_KV.put(`code:${cleanCode}`, JSON.stringify(codeRecord));
      }

      return new Response(JSON.stringify({
        success: true,
        output: generatedText,
        tasksRemaining: codeRecord ? codeRecord.remainingTasks : 0,
        remainingTasks: codeRecord ? codeRecord.remainingTasks : 0,
        modelUsed: successfulModel || modelCandidates[0]
      }), { status: 200, headers: jsonHeaders });
    }

    return new Response(JSON.stringify({ error: 'المسار المطلوب غير موجود.' }), { status: 404, headers: jsonHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: `حدث خطأ داخلي في الخادم: ${err.message}` }), { status: 500, headers: jsonHeaders });
  }
         }
        
