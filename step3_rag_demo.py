"""
Step 3: RAG Pipeline - Hands-on Demo

This strips away all the framework magic so you can see
exactly what's happening at each stage.

Run: python step3_rag_demo.py
"""

import os
from dotenv import load_dotenv
load_dotenv()

from openai import OpenAI

client = OpenAI()  # uses OPENAI_API_KEY from env

# ============================================================
# STAGE 1: Raw documents (imagine these are files in a codebase)
# ============================================================
documents = {
    "auth/login.ts": """
export async function handleLogin(email: string, password: string) {
    const user = await db.users.findByEmail(email);
    if (!user) throw new AuthError('User not found');
    
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new AuthError('Invalid credentials');
    
    const token = jwt.sign({ userId: user.id, role: user.role }, SECRET_KEY, {
        expiresIn: '24h'
    });
    
    await auditLog.record('LOGIN_SUCCESS', user.id);
    return { token, user: sanitizeUser(user) };
}
""",
    "auth/middleware.ts": """
export function requireAuth(req: Request, res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }
    
    try {
        const token = header.slice(7);
        const decoded = jwt.verify(token, SECRET_KEY);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}
""",
    "payments/processor.ts": """
export async function processPayment(orderId: string, amount: number) {
    const order = await db.orders.findById(orderId);
    if (!order) throw new PaymentError('Order not found');
    
    if (order.status === 'paid') {
        throw new PaymentError('Order already paid');
    }
    
    const charge = await stripe.charges.create({
        amount: Math.round(amount * 100),
        currency: 'cad',
        customer: order.customerId,
    });
    
    await db.orders.update(orderId, { 
        status: 'paid', 
        chargeId: charge.id 
    });
    
    await eventBus.emit('PAYMENT_COMPLETED', { orderId, chargeId: charge.id });
    return charge;
}
""",
    "payments/refund.ts": """
export async function processRefund(orderId: string, reason: string) {
    const order = await db.orders.findById(orderId);
    if (!order || order.status !== 'paid') {
        throw new PaymentError('Cannot refund unpaid order');
    }
    
    const refund = await stripe.refunds.create({
        charge: order.chargeId,
        reason: 'requested_by_customer',
    });
    
    await db.orders.update(orderId, { status: 'refunded' });
    await auditLog.record('REFUND_PROCESSED', { orderId, reason });
    return refund;
}
""",
    "config/database.ts": """
export const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'myapp',
    ssl: process.env.NODE_ENV === 'production',
    pool: { min: 2, max: 10 },
};

export async function initDatabase() {
    const pool = new Pool(dbConfig);
    await pool.query('SELECT 1');  // health check
    console.log('Database connected');
    return pool;
}
""",
}

print("=" * 60)
print("STAGE 1: Our 'codebase' - 5 files")
print("=" * 60)
for path in documents:
    print(f"  {path} ({len(documents[path].strip())} chars)")


# ============================================================
# STAGE 2: Chunking
# ============================================================
print("\n" + "=" * 60)
print("STAGE 2: Chunking")
print("=" * 60)

# Simple chunking - just use the whole file as one chunk 
# (these are small enough). In real life you'd split big files.
chunks = []
for path, content in documents.items():
    chunks.append({
        "text": content.strip(),
        "metadata": {"source": path}
    })

print(f"Created {len(chunks)} chunks (1 per file since they're small)")
print(f"In real codebases, a 500-line file might become 5-10 chunks")


# ============================================================
# STAGE 3: Embedding
# ============================================================
print("\n" + "=" * 60)
print("STAGE 3: Embedding each chunk")
print("=" * 60)

# Embed all chunks
texts = [c["text"] for c in chunks]
response = client.embeddings.create(
    model="text-embedding-3-small",
    input=texts
)

for i, (chunk, embedding_data) in enumerate(zip(chunks, response.data)):
    chunk["vector"] = embedding_data.embedding
    print(f"  {chunk['metadata']['source']}")
    print(f"    -> vector with {len(chunk['vector'])} dimensions")
    print(f"    -> first 5 values: {[round(v, 4) for v in chunk['vector'][:5]]}")

print(f"\nTotal tokens used for embedding: {response.usage.total_tokens}")


# ============================================================
# STAGE 4: Similarity Search (this is what the vector DB does)
# ============================================================
print("\n" + "=" * 60)
print("STAGE 4: Similarity Search")
print("=" * 60)

import math

def cosine_similarity(a, b):
    """The actual math behind vector search."""
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    return dot / (mag_a * mag_b)

# Three different queries to show how retrieval changes
queries = [
    "How does user authentication work?",
    "How do I process a refund?",
    "What database is this app using?",
]

for query in queries:
    print(f"\nQuery: \"{query}\"")
    
    # Embed the query with the SAME model
    q_response = client.embeddings.create(
        model="text-embedding-3-small",
        input=[query]
    )
    query_vector = q_response.data[0].embedding
    
    # Compare against every chunk (brute force - vector DBs do this efficiently)
    scores = []
    for chunk in chunks:
        sim = cosine_similarity(query_vector, chunk["vector"])
        scores.append((sim, chunk["metadata"]["source"]))
    
    # Sort by similarity (highest first)
    scores.sort(reverse=True)
    
    print("  Rankings:")
    for score, source in scores:
        bar = "#" * int(score * 40)
        print(f"    {score:.4f} {bar} {source}")
    
    print(f"  -> Top result: {scores[0][1]} (score: {scores[0][0]:.4f})")


# ============================================================
# STAGE 5: RAG Generation (the full pipeline)
# ============================================================
print("\n" + "=" * 60)
print("STAGE 5: Full RAG - Retrieval + Generation")
print("=" * 60)

question = "How does the app handle authentication? Walk me through the flow."
print(f"\nQuestion: \"{question}\"")

# Step 1: Embed the question
q_response = client.embeddings.create(
    model="text-embedding-3-small",
    input=[question]
)
query_vector = q_response.data[0].embedding

# Step 2: Find top 3 most relevant chunks
scores = []
for chunk in chunks:
    sim = cosine_similarity(query_vector, chunk["vector"])
    scores.append((sim, chunk))
scores.sort(reverse=True, key=lambda x: x[0])
top_chunks = scores[:3]

print(f"\nRetrieved top 3 chunks:")
for score, chunk in top_chunks:
    print(f"  {score:.4f} - {chunk['metadata']['source']}")

# Step 3: Build the prompt with retrieved context
context = ""
for score, chunk in top_chunks:
    context += f"\n--- {chunk['metadata']['source']} ---\n{chunk['text']}\n"

prompt = f"""Answer the question using ONLY the code context provided below.
Reference specific file paths and function names in your answer.
If the answer isn't in the context, say so.

CODE CONTEXT:
{context}

QUESTION: {question}"""

print(f"\nPrompt size: {len(prompt)} chars")
print(f"(This is what the LLM actually sees - your question + retrieved code)")

# Step 4: Send to LLM
print(f"\nGenerating answer...")
completion = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "system", "content": "You are a helpful code assistant. Be concise and specific."},
        {"role": "user", "content": prompt}
    ],
    temperature=0,
)

answer = completion.choices[0].message.content
print(f"\n{'─' * 60}")
print(f"ANSWER:\n{answer}")
print(f"{'─' * 60}")

print(f"\nTokens used for generation: {completion.usage.total_tokens}")
print(f"\nThat's the entire RAG pipeline. No magic. No framework.")
print(f"Embed -> Search -> Retrieve -> Stuff into prompt -> Generate.")
